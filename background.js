/**
 * background.js — MV3 service worker：設定供應與視窗操作
 * Handles GET_SETTINGS / RESIZE_WINDOW / OPEN_POPUP_PLAYER messages.
 *
 * Created: 2026-08-02
 * v2.0 完全沒有這支檔案，content script 送出的三種訊息都沒有接收端。
 */

importScripts('src/config.js', 'src/display.js');

const YAR_WINDOW_BOUNDS = { minWidth: 400, minHeight: 300, maxWidth: 7680, maxHeight: 4320 };
const YAR_POPUP_DEFAULT = { width: 960, height: 580 };

/* -------------------------------------------------------------- 顯示器查詢
 *
 * chrome.system.display 只有 service worker 拿得到（content script 沒有這個 API）。
 * 實測 macOS 上它回傳的 dpiX/dpiY 恆為 0、name 恆為空字串，因此它的用途嚴格限定在
 * 「邏輯座標與工作區」——也就是視窗定位。畫質決策的 DPR 一律由頁面端提供。
 */

/** 取得所有顯示器；API 不可用或出錯時回傳空陣列，絕不 reject */
function yarGetDisplays() {
  return new Promise((resolve) => {
    if (!chrome.system || !chrome.system.display || typeof chrome.system.display.getInfo !== 'function') {
      resolve([]);
      return;
    }
    chrome.system.display.getInfo((displays) => {
      if (chrome.runtime.lastError || !Array.isArray(displays)) {
        yarWarn('讀取顯示器資訊失敗:', chrome.runtime.lastError && chrome.runtime.lastError.message);
        resolve([]);
        return;
      }
      resolve(displays);
    });
  });
}

/** 取得視窗的座標；失敗回傳 null */
function yarGetWindowBounds(windowId) {
  return new Promise((resolve) => {
    if (!Number.isFinite(windowId)) {
      resolve(null);
      return;
    }
    chrome.windows.get(windowId, (win) => {
      resolve(chrome.runtime.lastError || !win ? null : win);
    });
  });
}

/** 依偏好解析出「視窗該開在哪台螢幕」 */
async function yarResolveTargetDisplay(preference, sourceWindowId) {
  const displays = await yarGetDisplays();
  if (displays.length === 0) return null;

  const sourceBounds = await yarGetWindowBounds(sourceWindowId);
  const currentDisplay = yarDisplayForWindow(displays, sourceBounds);
  return yarPickTargetDisplay(displays, preference, currentDisplay ? currentDisplay.id : '');
}

/** 視窗目前所在螢幕的分級資訊；查不到時回傳 null */
async function yarDisplayOfWindow(windowId) {
  const displays = await yarGetDisplays();
  if (displays.length === 0) return null;
  const bounds = await yarGetWindowBounds(windowId);
  return yarClassifyDisplay(yarDisplayForWindow(displays, bounds), null);
}

/**
 * 把 content script 送來的「內容需求」換算成實際視窗尺寸。
 *
 * 夾擠用的螢幕尺寸一律取自 chrome.system.display，不接受頁面端傳來的螢幕數字：
 * Brave 的指紋防護會把網頁看到的 screen.* 竄改成常見解析度（實測 3840x2160 的機器上
 * YouTube 頁面看到的是 1680x1050），照那個算會得到一個小一半的視窗。
 *
 * @param {{playerWidth:number, extraWidth:number, extraHeight:number, aspectRatio:number}} fit
 * @param {object|null} display yarClassifyDisplay 的輸出
 * @returns {{width:number, height:number}|null}
 */
function yarSizeFromFitRequest(fit, display) {
  if (!fit || typeof fit !== 'object') return null;
  const { playerWidth, extraWidth, extraHeight, aspectRatio } = fit;
  if (!Number.isFinite(playerWidth) || playerWidth <= 0) return null;

  const extraW = Number.isFinite(extraWidth) && extraWidth >= 0 ? extraWidth : 0;
  const extraH = Number.isFinite(extraHeight) && extraHeight >= 0 ? extraHeight : 0;
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;

  // 沒有螢幕資訊時退回「不夾擠」：給一個大到不會限制的可用區間，交給系統自己收
  const availWidth = display ? display.workArea.width : playerWidth + extraW;
  const availHeight = display ? display.workArea.height : Math.round(playerWidth / ratio) + extraH;

  return yarFitWindowSize(playerWidth, extraW, extraH, availWidth, availHeight, ratio);
}

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
async function yarHandleResizeWindow(message, sender) {
  if (!sender.tab || typeof sender.tab.windowId !== 'number') return;
  const windowId = sender.tab.windowId;

  /*
   * 上限改用「視窗實際所在那台螢幕的工作區」，而非固定的 7680×4320。
   * content script 看不到真實的螢幕尺寸（Brave 會竄改 screen.*），而且視窗被拖到另一台
   * 螢幕後，它連自己在哪台都不知道（本機兩台差距 1710 vs 3840，算錯會非常明顯）。
   */
  const display = await yarDisplayOfWindow(windowId);
  const maxWidth = display ? display.workArea.width : YAR_WINDOW_BOUNDS.maxWidth;
  const maxHeight = display ? display.workArea.height : YAR_WINDOW_BOUNDS.maxHeight;

  /*
   * 兩條路徑：
   * - fit：預測式計算（依畫質決定尺寸），螢幕資訊在這一端才是可信的
   * - width/height：彈出視窗的閉環校正，那是拿「實際量到的內容區」反推的修正量，
   *   與螢幕尺寸無關，原樣沿用即可
   */
  const requested = message.fit ? yarSizeFromFitRequest(message.fit, display) : message;

  const update = { state: 'normal' };
  if (requested && Number.isFinite(requested.width)) {
    update.width = yarClampDimension(requested.width, YAR_WINDOW_BOUNDS.minWidth, maxWidth);
  }
  if (requested && Number.isFinite(requested.height)) {
    update.height = yarClampDimension(requested.height, YAR_WINDOW_BOUNDS.minHeight, maxHeight);
  }
  if (update.width === undefined && update.height === undefined) return;

  chrome.windows.update(windowId, update, () => {
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

async function yarHandleOpenPopupPlayer(message, sender) {
  const url = yarBuildPopupUrl(message.videoId, message.startTime);
  if (!url) {
    yarWarn('無效的 videoId，已取消開啟彈出式播放器');
    return;
  }

  const settings = await yarLoadSettings();
  const target = await yarResolveTargetDisplay(
    settings.popupTargetDisplay,
    sender.tab && sender.tab.windowId
  );
  const classified = yarClassifyDisplay(target, null);

  /*
   * 尺寸一律用**目標螢幕**的工作區來算，不能沿用來源視窗那台的數字：
   * 內建 1710x1073 與外接 4K 3840x2130 差了一倍以上，算錯的話彈出視窗不是太小就是超出邊界。
   * 算完再置中定位——不指定 left/top 的話瀏覽器會自己決定，多半落在主螢幕上。
   */
  const sized = yarSizeFromFitRequest(message.fit, classified);
  const requested = (sized && yarClampWindowSize(sized.width, sized.height)) || YAR_POPUP_DEFAULT;
  const placement = classified
    ? yarFitIntoWorkArea(requested.width, requested.height, classified.workArea)
    : requested;

  chrome.windows.create({ url, type: 'popup', focused: true, ...placement }, (win) => {
    if (chrome.runtime.lastError) {
      yarWarn('開啟彈出式播放器失敗:', chrome.runtime.lastError.message);
      return;
    }
    const tabId = win && win.tabs && win.tabs[0] && win.tabs[0].id;
    if (Number.isFinite(tabId)) yarUpdatePopupTabs((ids) => yarAddPopupTab(ids, tabId));
  });
}

/**
 * 回覆顯示器清單給 popup 設定面板。
 *
 * DPR 只能由呼叫端提供（popup 自己的 window.devicePixelRatio），而且只對「popup 目前所在
 * 那一台」有效——macOS 的 chrome.system.display 不提供任何 dpi 資訊。
 */
async function yarHandleGetDisplays(message, sendResponse) {
  const displays = await yarGetDisplays();
  const focused = await new Promise((resolve) => {
    chrome.windows.getLastFocused({}, (win) => resolve(chrome.runtime.lastError ? null : win));
  });
  const current = yarDisplayForWindow(displays, focused);
  const currentId = current ? current.id : '';
  const dpr = Number.isFinite(message && message.dpr) ? message.dpr : null;

  sendResponse({
    currentId,
    displays: displays
      .map((raw) => yarClassifyDisplay(raw, raw && raw.id === currentId ? dpr : null))
      .filter(Boolean)
      .map((d) => ({
        id: d.id,
        label: yarDescribeDisplay(d),
        tier: d.tier,
        isInternal: d.isInternal,
        isPrimary: d.isPrimary,
        logicalWidth: d.logicalWidth,
        logicalHeight: d.logicalHeight,
        physicalWidth: d.physicalWidth
      }))
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.action !== 'string') return false;

  switch (message.action) {
    case YAR_MSG.GET_SETTINGS:
      yarLoadSettings().then(sendResponse);
      return true; // 非同步回覆
    /*
     * 以下三個 handler 是非同步的，呼叫端不等回覆（return false）。它們目前不會 reject
     * 是因為每個被 await 的輔助函式都刻意寫成「絕不 reject」，但那是隱性約定 ——
     * 日後任何一支改成會 throw，就會變成 service worker 裡完全沒有症狀的 unhandled rejection。
     * 一律接住並記錄，把約定寫在呼叫端而不是靠下游永遠守規矩。
     */
    case YAR_MSG.RESIZE_WINDOW:
      yarHandleResizeWindow(message, sender).catch((err) => yarWarn('調整視窗失敗:', err.message));
      return false;
    case YAR_MSG.OPEN_POPUP_PLAYER:
      yarHandleOpenPopupPlayer(message, sender)
        .catch((err) => yarWarn('開啟彈出式播放器失敗:', err.message));
      return false;
    case YAR_MSG.IS_POPUP_PLAYER:
      yarHandleIsPopupPlayer(sender, sendResponse);
      return true; // 非同步回覆
    case YAR_MSG.GET_DISPLAYS:
      // 這個有回覆：出錯時仍要回一個空清單，否則 popup 的 callback 永遠等不到
      yarHandleGetDisplays(message, sendResponse).catch((err) => {
        yarWarn('取得顯示器資訊失敗:', err.message);
        sendResponse({ currentId: '', displays: [] });
      });
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
