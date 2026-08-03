/**
 * background.js — MV3 service worker：設定供應與視窗操作
 * Handles GET_SETTINGS / RESIZE_WINDOW / OPEN_POPUP_PLAYER messages.
 *
 * Created: 2026-08-02
 * v2.0 完全沒有這支檔案，content script 送出的三種訊息都沒有接收端。
 */

importScripts('src/config.js');

const YAR_WINDOW_BOUNDS = { minWidth: 400, minHeight: 300, maxWidth: 7680, maxHeight: 4320 };
const YAR_POPUP_DEFAULT = { width: 960, height: 580 };

/** 單一維度夾擠 */
function yarClampDimension(value, min, max) {
  return Math.round(Math.min(Math.max(value, min), max));
}

/** 夾擠到合法視窗尺寸；非數字回傳 null */
function yarClampWindowSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: yarClampDimension(width, YAR_WINDOW_BOUNDS.minWidth, YAR_WINDOW_BOUNDS.maxWidth),
    height: yarClampDimension(height, YAR_WINDOW_BOUNDS.minHeight, YAR_WINDOW_BOUNDS.maxHeight)
  };
}

/**
 * 只接受合法的 11 碼 videoId 與非負秒數，避免拼出非預期的 URL。
 * 走一般 watch 頁 + hash 標記，由 content script 收成純播放器；
 * 不用 /embed/（頂層開啟一律回錯誤 153，見 config.js 的 YAR_POPUP_MARKER 說明）。
 */
function yarBuildPopupUrl(videoId, startTime) {
  if (typeof videoId !== 'string' || !YAR_VIDEO_ID_PATTERN.test(videoId)) return null;
  const start = Number.isFinite(startTime) && startTime > 0 ? Math.floor(startTime) : 0;
  return `https://www.youtube.com/watch?v=${videoId}&t=${start}s#${YAR_POPUP_MARKER}`;
}

/**
 * 支援只更新單一維度。彈出視窗校正時，一旦偵測到高度被系統限制（macOS 選單列會把
 * 放在工作區外的視窗往下推並截短），就必須停止重送高度 —— 每重送一次都會再損失
 * 一個選單列的高度，視窗會一路縮小下去。
 */
function yarHandleResizeWindow(message, sender) {
  if (!sender.tab || typeof sender.tab.windowId !== 'number') return;

  const update = { state: 'normal' };
  if (Number.isFinite(message.width)) {
    update.width = yarClampDimension(message.width, YAR_WINDOW_BOUNDS.minWidth, YAR_WINDOW_BOUNDS.maxWidth);
  }
  if (Number.isFinite(message.height)) {
    update.height = yarClampDimension(message.height, YAR_WINDOW_BOUNDS.minHeight, YAR_WINDOW_BOUNDS.maxHeight);
  }
  if (update.width === undefined && update.height === undefined) return;

  chrome.windows.update(sender.tab.windowId, update, () => {
    if (chrome.runtime.lastError) yarWarn('調整視窗失敗:', chrome.runtime.lastError.message);
  });
}

function yarHandleOpenPopupPlayer(message) {
  const url = yarBuildPopupUrl(message.videoId, message.startTime);
  if (!url) {
    yarWarn('無效的 videoId，已取消開啟彈出式播放器');
    return;
  }
  const size = yarClampWindowSize(message.width, message.height) || YAR_POPUP_DEFAULT;
  chrome.windows.create({ url, type: 'popup', focused: true, ...size }, () => {
    if (chrome.runtime.lastError) yarWarn('開啟彈出式播放器失敗:', chrome.runtime.lastError.message);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') return false;

  switch (message.action) {
    case YAR_MSG.GET_SETTINGS:
      yarLoadSettings().then(sendResponse);
      return true; // 非同步回覆
    case YAR_MSG.RESIZE_WINDOW:
      yarHandleResizeWindow(message, sender);
      return false;
    case YAR_MSG.OPEN_POPUP_PLAYER:
      yarHandleOpenPopupPlayer(message);
      return false;
    default:
      return false;
  }
});

/**
 * v2.0 的 popup 把設定寫在 chrome.storage.local 的扁平鍵上（content script 從來讀不到）。
 * 升級時做一次性遷移，讓舊使用者的偏好不會憑空消失。
 */
function yarMigrateLegacyLocalSettings() {
  chrome.storage.local.get(YAR_LEGACY_LOCAL_KEYS, (legacy) => {
    if (chrome.runtime.lastError || !legacy) return;
    const hasLegacy = YAR_LEGACY_LOCAL_KEYS.some((key) => legacy[key] !== undefined);
    if (!hasLegacy) return;

    chrome.storage.sync.get([YAR_STORAGE_KEY], (current) => {
      if (chrome.runtime.lastError || (current && current[YAR_STORAGE_KEY])) return;
      yarSaveSettings({
        enabled: legacy.enabled,
        resizeMode: legacy.resizeMode,
        preferredQuality: legacy.quality,
        removeSideGaps: legacy.removeSideGaps
      })
        .then(() => chrome.storage.local.remove(YAR_LEGACY_LOCAL_KEYS))
        .catch((err) => yarWarn('舊設定遷移失敗:', err.message));
    });
  });
}

chrome.runtime.onInstalled.addListener(yarMigrateLegacyLocalSettings);
