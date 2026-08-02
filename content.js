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

  let settings = yarNormalizeSettings(null);
  let lastQuality = null;
  let lastVideoId = null;
  let lastVideoW = 0;
  let lastVideoH = 0;
  let qualityLockedFor = null;
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

  /** 由 background.js 開啟的彈出式播放器視窗（以 URL hash 標記） */
  function isPopupPlayerWindow() {
    return window.location.hash.slice(1) === YAR_POPUP_MARKER;
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
    const measured = measuredWindowChrome();

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
    const isPopup = isPopupPlayerWindow();
    if (!isPopup && (!settings.resizeMainWindow || !settings.enabled)) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

    const size = windowSizeForQuality(isPopup);
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
   * 彈出視窗剛開啟時 innerWidth/innerHeight 還在變動，量到的外框尺寸不可信。
   * 視窗尺寸穩定後再校正一次，讓內容區精準等於影片長寬比。
   */
  function scheduleWindowCalibration() {
    if (!isPopupPlayerWindow()) return;
    [400, 1200, 2500].forEach((delay) => setTimeout(syncBrowserWindow, delay));
  }

  // ------------------------------------------------ 主世界畫質事件接收

  function handleQualityChange(event) {
    const detail = event.detail || {};
    if (!detail.quality) return;

    if (detail.videoId && detail.videoId !== lastVideoId) {
      lastVideoId = detail.videoId;
      qualityLockedFor = null;
      lastSentWindowSize = '';
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
