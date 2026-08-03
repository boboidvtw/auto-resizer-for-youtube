/**
 * content.js — 隔離世界主控：設定、樣式套用、主世界腳本注入、控制列按鈕
 * Isolated-world orchestrator.
 *
 * Updated: 2026-08-02
 * 依賴 (depends on): src/config.js, src/layout.js（由 manifest 依序注入）
 */

(function () {
  'use strict';

  const STYLE_ELEMENT_ID = 'yt-auto-resizer-dynamic-style';
  const POPUP_BUTTON_ID = 'yt-resizer-popup-btn';
  const MAIN_WORLD_SCRIPTS = ['injected.js', 'pageScript.js'];
  const BUTTON_RETRY_INTERVAL_MS = 500;
  const BUTTON_MAX_RETRIES = 20;
  const POPUP_MAX_CALIBRATIONS = 8;
  /** 收斂容差：視窗尺寸有系統粒度，硬要逼到 1px 只會換來無效重試 */
  const POPUP_CALIBRATION_TOLERANCE_PX = 8;

  let settings = yarNormalizeSettings(null);
  let lastQuality = null;
  let lastVideoId = null;
  let lastVideoW = 0;
  let lastVideoH = 0;
  let qualityLockedFor = null;
  let popupPlayerWindow = false;
  let lastRequestedOuter = null;
  /** 系統對視窗高度的限制（選單列 / Dock）不會消失，一旦偵測到就永久記住 */
  let popupHeightCapped = false;
  let popupCalibrations = 0;
  let popupCalibrationScheduled = false;
  // 記錄「上次送出的視窗尺寸」而非畫質：彈出視窗第一次是用估計的外框高度開的，
  // 載入後量到真實外框才能算出正確尺寸並再送一次校正，用畫質去防重複會擋掉這次校正。
  let lastSentWindowSize = '';
  let lastWindowResizeAt = 0;
  let buttonRetries = 0;
  let buttonTimer = null;

  // ---------------------------------------------------------------- 頁面判斷

  function isWatchPage() {
    return window.location.pathname.startsWith('/watch') || !!document.querySelector('ytd-watch-flexy');
  }

  // ---------------------------------------------------------------- 樣式套用

  function getStyleElement() {
    let el = document.getElementById(STYLE_ELEMENT_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ELEMENT_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    return el;
  }

  function clearStyle() {
    const el = document.getElementById(STYLE_ELEMENT_ID);
    if (el) el.textContent = '';
  }

  /**
   * 由 background.js 開啟的彈出式播放器視窗。
   *
   * 標記是 URL hash，但 YouTube 的 SPA 在載入完成後會用 replaceState 把 hash 清掉，
   * 所以不能每次都重新讀 hash —— 一旦讀不到就會退回一般模式，把 popup 樣式覆蓋掉、
   * 視窗尺寸校正也一併失效（實測就是這樣造成播放器四周出現黑邊）。
   * 因此只要認出過一次就記住，並額外接受我們自己掛在 <html> 上的屬性作為佐證。
   */
  function isPopupPlayerWindow() {
    if (popupPlayerWindow) return true;
    if (
      window.location.hash.slice(1) === YAR_POPUP_MARKER ||
      document.documentElement.hasAttribute(YAR_POPUP_ATTRIBUTE)
    ) {
      popupPlayerWindow = true;
    }
    return popupPlayerWindow;
  }

  function applyPlayerLayout() {
    if (!isWatchPage()) {
      clearStyle();
      return;
    }
    if (isPopupPlayerWindow()) {
      document.documentElement.setAttribute(YAR_POPUP_ATTRIBUTE, '');
      getStyleElement().textContent = yarBuildPopupPlayerCss();
      return;
    }
    const css = yarBuildPlayerCss(settings, lastQuality || 'hd1080');
    getStyleElement().textContent = css;
    yarLog('已套用版面', settings.resizeMode, lastQuality, css ? '' : '(已清空)');
  }

  // ---------------------------------------------------------------- 設定同步

  function adoptSettings(next) {
    settings = yarNormalizeSettings(next);
    qualityLockedFor = null;   // 設定變更後允許重新鎖定畫質
    lastSentWindowSize = '';
    applyPlayerLayout();
    pushPreferredQuality();
    requestMainWorldState();
  }

  yarLoadSettings().then(adoptSettings);

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync' || !changes[YAR_STORAGE_KEY]) return;
      adoptSettings(changes[YAR_STORAGE_KEY].newValue);
    });
  }

  // ------------------------------------------------------- 主世界腳本注入

  /** 要求主世界重播目前畫質狀態（同一支影片只會主動廣播一次，晚註冊者需主動索取） */
  function requestMainWorldState() {
    document.dispatchEvent(new CustomEvent(YAR_CHANNEL.REQUEST_STATE));
  }

  function injectMainWorldScripts() {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function') return;
    MAIN_WORLD_SCRIPTS.forEach((file) => {
      const flagId = `yt-auto-resizer-${file.replace('.js', '')}-flag`;
      if (document.getElementById(flagId)) {
        requestMainWorldState();
        return;
      }
      try {
        const script = document.createElement('script');
        script.id = flagId;
        script.src = chrome.runtime.getURL(file);
        script.onload = requestMainWorldState;
        (document.head || document.documentElement).appendChild(script);
      } catch (err) {
        yarWarn(`注入 ${file} 失敗:`, err.message);
      }
    });
  }

  injectMainWorldScripts();

  // ---------------------------------------------------------------- 畫質鎖定

  function pushPreferredQuality() {
    if (!settings.enabled || settings.preferredQuality === 'auto') return;
    if (!isWatchPage() || !lastVideoId || qualityLockedFor === lastVideoId) return;
    qualityLockedFor = lastVideoId;
    window.postMessage(
      {
        type: YAR_CHANNEL.ACTION,
        action: YAR_CHANNEL.SET_QUALITY,
        payload: { quality: settings.preferredQuality }
      },
      window.location.origin
    );
    yarLog('要求鎖定畫質', settings.preferredQuality);
  }

  // ------------------------------------------------------- 瀏覽器視窗同步

  /**
   * 實測視窗外框（標題列、分頁列、網址列…）佔掉的尺寸。
   * 這個值無法事先猜：一般視窗有分頁列與網址列（實測 171px），彈出視窗只有標題列，
   * 而且隨平台與瀏覽器而異。猜錯的直接後果就是內容區不是 16:9、影片上下或左右出現黑邊。
   * @returns {{width: number, height: number}|null} 尚未量得可信值時回傳 null
   */
  function measuredWindowChrome() {
    const extraWidth = window.outerWidth - window.innerWidth;
    const extraHeight = window.outerHeight - window.innerHeight;
    if (!Number.isFinite(extraWidth) || !Number.isFinite(extraHeight)) return null;
    if (extraWidth < 0 || extraHeight <= 0) return null;
    return { width: extraWidth, height: extraHeight };
  }

  /** 影片實際長寬比；取不到時退回 16:9 */
  function currentAspectRatio() {
    if (lastVideoW > 0 && lastVideoH > 0) return lastVideoW / lastVideoH;
    return 16 / 9;
  }

  /**
   * 依目前畫質算出視窗該有的尺寸。
   * 這裡用 screen.avail* 是正確的：目標是實體螢幕上的「瀏覽器視窗」，
   * 而非頁面版面（版面用的是 CSS 的 100vw/100vh）。
   */
  function windowSizeForQuality(isPopup) {
    const playerWidth = YAR_QUALITY_WIDTH[lastQuality] || YAR_QUALITY_WIDTH.hd1080;
    // 實測值只在「要調整的視窗就是自己」時才適用。主視窗替尚未存在的彈出視窗算尺寸時，
    // 量到的是主視窗的分頁列與網址列，套用在彈出視窗上會整個算錯，只能先用估計值，
    // 待彈出視窗自己載入後再校正。
    const measured = isPopup === isPopupPlayerWindow() ? measuredWindowChrome() : null;

    const contentExtraWidth = isPopup
      ? 0
      : YAR_LAYOUT.SIDEBAR_WIDTH + YAR_LAYOUT.COLUMN_GAP + YAR_LAYOUT.PAGE_PADDING + YAR_LAYOUT.SCROLLBAR_RESERVE;
    const fallbackChromeHeight = isPopup
      ? YAR_LAYOUT.POPUP_CHROME_HEIGHT
      : YAR_LAYOUT.MASTHEAD_HEIGHT + YAR_LAYOUT.WINDOW_CHROME_HEIGHT;

    const extraWidth = contentExtraWidth + (measured ? measured.width : 0);
    const extraHeight = measured ? measured.height : fallbackChromeHeight;

    const screenInfo = window.screen || {};
    return yarFitWindowSize(
      playerWidth,
      extraWidth,
      extraHeight,
      screenInfo.availWidth || playerWidth + extraWidth,
      screenInfo.availHeight || Math.round(playerWidth / currentAspectRatio()) + extraHeight,
      currentAspectRatio()
    );
  }

  /**
   * 彈出視窗一律跟著畫質調整尺寸（那正是它的用途）；
   * 一般視窗只在使用者開啟「同步調整瀏覽器視窗尺寸」時才動。
   */
  function syncBrowserWindow() {
    if (!isWatchPage()) return;
    // 彈出視窗的尺寸由 calibratePopupWindow() 的閉環校正負責，不走預測式計算
    if (isPopupPlayerWindow()) return;
    if (!settings.resizeMainWindow || !settings.enabled) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

    const size = windowSizeForQuality(false);
    const signature = `${size.width}x${size.height}`;
    if (signature === lastSentWindowSize) return;

    const now = Date.now();
    if (now - lastWindowResizeAt < YAR_WINDOW_RESIZE_COOLDOWN_MS) return;

    lastSentWindowSize = signature;
    lastWindowResizeAt = now;
    chrome.runtime.sendMessage(
      Object.assign({ action: YAR_MSG.RESIZE_WINDOW }, size),
      () => void chrome.runtime.lastError
    );
    yarLog('要求調整視窗尺寸', lastQuality, signature);
  }

  /**
   * 彈出視窗的閉環尺寸校正。
   *
   * 不用「預測」的方式算視窗尺寸：實際拿到的尺寸會被一堆量不到的因素影響
   * （macOS 選單列、Dock、瀏覽器對視窗尺寸的下限）。實測就發生過要求 952 高
   * 卻只拿到 927 的情形，內容區因此不是 16:9，播放器左右仍留黑邊。
   *
   * 改成用「目前實際的內容區」反推修正量，多跑幾輪自然收斂：
   * 先試著調高度；若偵測到高度已被系統限制住，就改縮寬度來符合比例。
   */
  function calibratePopupWindow() {
    if (!isPopupPlayerWindow()) return;
    if (popupCalibrations >= POPUP_MAX_CALIBRATIONS) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    if (innerW < 1 || innerH < 1) return;

    const chromeW = window.outerWidth - innerW;
    const chromeH = window.outerHeight - innerH;
    const aspect = currentAspectRatio();

    /*
     * 高度受限必須是「單向」判斷。曾經每輪重新判斷，結果縮寬那一輪的高度要求剛好等於
     * 目前高度、必然達成，下一輪就誤認為限制解除又去加高，兩個狀態無限震盪，
     * 視窗還會每輪微幅長大。系統加的限制不會消失，記住即可。
     */
    if (lastRequestedOuter && window.outerHeight < lastRequestedOuter.height - 2) {
      popupHeightCapped = true;
    }

    const targetInnerW = popupHeightCapped ? Math.round(innerH * aspect) : innerW;
    const targetInnerH = popupHeightCapped ? innerH : Math.round(innerW / aspect);

    if (
      Math.abs(targetInnerW - innerW) < POPUP_CALIBRATION_TOLERANCE_PX &&
      Math.abs(targetInnerH - innerH) < POPUP_CALIBRATION_TOLERANCE_PX
    ) {
      return;
    }

    const size = { width: targetInnerW + chromeW, height: targetInnerH + chromeH };
    lastRequestedOuter = size;
    lastSentWindowSize = `${size.width}x${size.height}`;
    popupCalibrations += 1;

    /*
     * 高度受限後絕對不能再送 height：系統每次都會再截掉一個選單列的高度
     * （實測要求 900 只拿到 875），連送幾輪視窗就一路縮小。只調寬度即可收斂。
     */
    const payload = { action: YAR_MSG.RESIZE_WINDOW, width: size.width };
    if (!popupHeightCapped) payload.height = size.height;

    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    yarLog(
      '彈出視窗校正',
      `${innerW}x${innerH} -> 內容 ${targetInnerW}x${targetInnerH}`,
      popupHeightCapped ? '(高度受限，改縮寬)' : ''
    );
  }

  /** 視窗尺寸與影片資訊都需要時間穩定，分幾輪校正到收斂；每支影片只排一次 */
  function scheduleWindowCalibration() {
    if (!isPopupPlayerWindow() || popupCalibrationScheduled) return;
    popupCalibrationScheduled = true;
    [400, 1200, 2500, 4000, 6000].forEach((delay) => setTimeout(calibratePopupWindow, delay));
  }

  // ------------------------------------------------ 主世界畫質事件接收

  function handleQualityChange(event) {
    const detail = event.detail || {};
    if (!detail.quality) return;

    if (detail.videoId && detail.videoId !== lastVideoId) {
      lastVideoId = detail.videoId;
      qualityLockedFor = null;
      lastSentWindowSize = '';
      popupCalibrations = 0;
      popupCalibrationScheduled = false;
    }
    lastQuality = detail.quality;
    if (detail.videoWidth > 0 && detail.videoHeight > 0) {
      lastVideoW = detail.videoWidth;
      lastVideoH = detail.videoHeight;
    }

    applyPlayerLayout();
    pushPreferredQuality();
    syncBrowserWindow();
    scheduleWindowCalibration();
  }

  document.addEventListener(YAR_CHANNEL.QUALITY_CHANGED, handleQualityChange);

  // ---------------------------------------------------------------- SPA 導航

  function handlePageNavigation() {
    injectMainWorldScripts();
    if (!isWatchPage()) {
      clearStyle();
      lastQuality = null;
      lastVideoId = null;
      return;
    }
    applyPlayerLayout();
    scheduleButtonInjection();
    requestMainWorldState();
  }

  document.addEventListener('yt-navigate-finish', handlePageNavigation);
  document.addEventListener('yt-page-data-updated', handlePageNavigation);
  window.addEventListener('popstate', handlePageNavigation);

  // ------------------------------------------------- 控制列彈出播放器按鈕

  function openPopupPlayer(event) {
    event.preventDefault();
    event.stopPropagation();

    const video = document.querySelector('video');
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (!videoId || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

    if (video) video.pause();

    chrome.runtime.sendMessage(
      Object.assign(
        {
          action: YAR_MSG.OPEN_POPUP_PLAYER,
          videoId,
          startTime: video ? Math.floor(video.currentTime) : 0
        },
        windowSizeForQuality(true)
      ),
      () => void chrome.runtime.lastError
    );
  }

  function buildPopupButton() {
    const button = document.createElement('button');
    button.id = POPUP_BUTTON_ID;
    button.className = 'ytp-button';
    button.title = '彈出式播放器 (Pop-up Player)';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('viewBox', '0 0 36 36');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', '#fff');
    path.setAttribute(
      'd',
      'M19,11 L25,11 L25,17 L23,17 L23,14.41 L17.41,20 L16,18.59 L21.59,13 L19,13 L19,11 Z M11,13 L15,13 L15,15 L13,15 L13,23 L21,23 L21,21 L23,21 L23,25 L11,25 L11,13 Z'
    );

    svg.appendChild(path);
    button.appendChild(svg);
    button.addEventListener('click', openPopupPlayer);
    return button;
  }

  /** @returns {boolean} 是否已完成注入（含先前已存在的情況） */
  function injectPopupButton() {
    // 彈出視窗裡再放一顆「彈出」按鈕沒有意義，也避免使用者無限開視窗
    if (isPopupPlayerWindow()) return true;
    if (document.getElementById(POPUP_BUTTON_ID)) return true;
    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return false;
    try {
      rightControls.insertBefore(buildPopupButton(), rightControls.firstChild);
      return true;
    } catch (err) {
      yarWarn('注入彈出播放器按鈕失敗:', err.message);
      return true; // 失敗就不再重試，避免無限迴圈
    }
  }

  /** 有界重試：找到控制列即停，不做永久輪詢 */
  function scheduleButtonInjection() {
    if (buttonTimer) clearTimeout(buttonTimer);
    buttonRetries = 0;
    const attempt = () => {
      buttonTimer = null;
      if (injectPopupButton() || !isWatchPage()) return;
      if (++buttonRetries > BUTTON_MAX_RETRIES) return;
      buttonTimer = setTimeout(attempt, BUTTON_RETRY_INTERVAL_MS);
    };
    attempt();
  }

  scheduleButtonInjection();
})();
