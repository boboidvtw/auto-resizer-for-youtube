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

/* -------------------------------------------------- 彈出播放器分頁的身分登記
 *
 * 原本靠 URL hash (#yar-popup) 讓 content script 認出自己，但 YouTube 的 SPA 載入後會
 * replaceState 把 hash 清掉。清掉的時機和 content script 在 document_idle 執行的時機是
 * 競態 —— 慢一步就永遠讀不到標記，彈出視窗於是套用一般版面（頁首、推薦欄全都在，
 * 尺寸校正也失效）。實測就重現過。
 *
 * service worker 是唯一知道「這個分頁是我開的」的一方，改由它來回答；
 * 存在 storage.session 是為了撐過 service worker 的閒置回收。
 */

/** 純函式：登記分頁 id（去重、不修改輸入） */
function yarAddPopupTab(tabIds, tabId) {
  const ids = Array.isArray(tabIds) ? tabIds : [];
  if (!Number.isFinite(tabId) || ids.includes(tabId)) return ids.slice();
  return ids.concat(tabId);
}

/** 純函式：移除已關閉的分頁 id */
function yarRemovePopupTab(tabIds, tabId) {
  const ids = Array.isArray(tabIds) ? tabIds : [];
  return ids.filter((id) => id !== tabId);
}

function yarUpdatePopupTabs(transform) {
  chrome.storage.session.get([YAR_POPUP_TABS_KEY], (stored) => {
    if (chrome.runtime.lastError) return;
    const next = transform(stored && stored[YAR_POPUP_TABS_KEY]);
    chrome.storage.session.set({ [YAR_POPUP_TABS_KEY]: next });
  });
}

function yarHandleIsPopupPlayer(sender, sendResponse) {
  const tabId = sender.tab && sender.tab.id;
  if (!Number.isFinite(tabId)) {
    sendResponse({ isPopupPlayer: false });
    return;
  }
  chrome.storage.session.get([YAR_POPUP_TABS_KEY], (stored) => {
    const ids = (stored && stored[YAR_POPUP_TABS_KEY]) || [];
    sendResponse({ isPopupPlayer: Array.isArray(ids) && ids.includes(tabId) });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  yarUpdatePopupTabs((ids) => yarRemovePopupTab(ids, tabId));
});

function yarHandleOpenPopupPlayer(message) {
  const url = yarBuildPopupUrl(message.videoId, message.startTime);
  if (!url) {
    yarWarn('無效的 videoId，已取消開啟彈出式播放器');
    return;
  }
  const size = yarClampWindowSize(message.width, message.height) || YAR_POPUP_DEFAULT;
  chrome.windows.create({ url, type: 'popup', focused: true, ...size }, (win) => {
    if (chrome.runtime.lastError) {
      yarWarn('開啟彈出式播放器失敗:', chrome.runtime.lastError.message);
      return;
    }
    const tabId = win && win.tabs && win.tabs[0] && win.tabs[0].id;
    if (Number.isFinite(tabId)) yarUpdatePopupTabs((ids) => yarAddPopupTab(ids, tabId));
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
    case YAR_MSG.IS_POPUP_PLAYER:
      yarHandleIsPopupPlayer(sender, sendResponse);
      return true; // 非同步回覆
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
