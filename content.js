/**
 * content.js — 隔離世界主控：設定、樣式套用、主世界腳本注入、控制列按鈕
 * Isolated-world orchestrator.
 *
 * Updated: 2026-08-07
 * 依賴 (depends on): src/config.js, src/display.js, src/layout.js,
 *                    src/quality-policy.js, src/window-fit.js（由 manifest 依序注入）
 *
 * 分工：凡是「算得出答案」的部分都住在 src/ 底下的純函式模組，本檔只負責 DOM、chrome API、
 * 主世界訊息與狀態的編排。這條界線是刻意的——留在這裡的東西一律只能靠開瀏覽器驗證。
 */

(function () {
  'use strict';

  const STYLE_ELEMENT_ID = 'yt-auto-resizer-dynamic-style';
  const POPUP_BUTTON_ID = 'yt-resizer-popup-btn';
  const MAIN_WORLD_SCRIPTS = ['injected.js', 'pageScript.js'];
  const BUTTON_RETRY_INTERVAL_MS = 500;
  const BUTTON_MAX_RETRIES = 20;
  const POPUP_MAX_CALIBRATIONS = 8;
  /**
   * 降畫質要等它穩定才縮小播放器。YouTube 的 ABR 幾乎每支影片開播都是由低往上爬
   * （medium -> hd720 -> hd1080），中途也會因網路抖動短暫掉下來；照單全收的話
   * autoByQuality 模式下播放器會在開播前十秒連跳好幾次尺寸。
   */
  const QUALITY_SHRINK_SETTLE_MS = 4000;
  /** 視窗縮放／換螢幕後等它停下來再重算畫質，避免拖曳過程中連續送出請求 */
  const DISPLAY_SETTLE_MS = 500;

  let settings = yarNormalizeSettings(null);
  /** 版面實際採用的畫質（升畫質立即跟進，降畫質需先穩定） */
  let lastQuality = null;
  /** 主世界最後一次回報的畫質，用來判斷降畫質是否已經穩定 */
  let reportedQuality = null;
  let shrinkTimer = null;
  let lastVideoId = null;
  let lastVideoW = 0;
  let lastVideoH = 0;
  /** 這支影片實際提供的畫質清單（主世界回報）；空陣列代表尚未就緒 */
  let availableQualities = [];
  /** 已送出的畫質請求簽章 `${videoId}_${畫質}`，避免對同一目標反覆下指令 */
  let qualityRequestSignature = '';
  let displayQuery = null;
  let displaySettleTimer = null;
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
   * URL hash 標記只是快速路徑：YouTube 的 SPA 載入完成後會用 replaceState 把 hash 清掉，
   * 而清掉的時機與本 script 在 document_idle 執行的時機是競態 —— 慢一步就永遠讀不到，
   * 於是彈出視窗套用一般版面（頁首與推薦欄都在、尺寸校正失效）。實測重現過。
   * 權威答案來自 service worker（見 askServiceWorkerIfPopupPlayer），它才知道分頁是誰開的。
   * 認出過一次就記住，並接受我們自己掛在 <html> 上的屬性作為佐證。
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

  /** 向 service worker 確認身分；只在還沒認出時問，答案為是就立刻改套 popup 版面 */
  function askServiceWorkerIfPopupPlayer() {
    if (popupPlayerWindow) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;
    chrome.runtime.sendMessage({ action: YAR_MSG.IS_POPUP_PLAYER }, (response) => {
      if (chrome.runtime.lastError || !response || !response.isPopupPlayer || popupPlayerWindow) return;
      popupPlayerWindow = true;
      applyPlayerLayout();
      scheduleWindowCalibration();
      // 回覆是非同步的，這之前可能已經照一般視窗的規則裝上了彈出按鈕，要收回來
      removePopupButton();
    });
  }

  // ------------------------------------------------------- 螢幕感知（多螢幕）

  /*
   * 為什麼 DPR 要從這裡拿而不是從 chrome.system.display：
   * macOS 上該 API 的 dpiX/dpiY 實測恆為 0（2026-08-04 雙螢幕實測），只提供邏輯座標。
   * 唯一拿得到 DPR 的地方就是 content script 自己，而且只涵蓋視窗目前所在那一台螢幕 ——
   * 這正好就是我們要的：畫質該多高，取決於使用者現在正在看的那台。
   *
   * 決策本身住在 src/quality-policy.js；本檔只負責把「現在的狀態」收集起來交給它。
   */

  /** 把散落的模組層級狀態收成一份快照，交給 quality-policy.js 的純函式 */
  function displayState() {
    return {
      quality: lastQuality,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dpr: window.devicePixelRatio,
      isPopupPlayer: isPopupPlayerWindow(),
      availableQualities,
      videoWidth: lastVideoW,
      videoHeight: lastVideoH
    };
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
    const context = yarLayoutContextFor(settings, displayState());
    const css = yarBuildPlayerCss(settings, lastQuality || YAR_CEILING_PROBE_QUALITY, context);
    getStyleElement().textContent = css;
    yarLog('已套用版面', settings.resizeMode, lastQuality, css ? '' : '(已清空)');
  }

  // ---------------------------------------------------------------- 設定同步

  function adoptSettings(next) {
    settings = yarNormalizeSettings(next);
    qualityRequestSignature = '';   // 設定變更後允許重新請求畫質
    lastSentWindowSize = '';
    applyPlayerLayout();
    pushDesiredQuality();
    requestMainWorldState();
  }

  yarLoadSettings().then(adoptSettings);
  askServiceWorkerIfPopupPlayer();

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

  /**
   * 送出畫質請求。使用者明確指定的畫質永遠優先；設為「自動」時才由螢幕決定。
   *
   * 去重簽章用 `videoId + 目標畫質` 而非只用 videoId：
   * - 同一支影片、同一個目標 → 只送一次，不會和使用者在 YouTube 選單裡的手動選擇互相拉扯
   * - 視窗移到另一台螢幕或縮放後目標改變 → 簽章跟著變，會重新請求（這正是多螢幕要的行為）
   */
  function pushDesiredQuality() {
    if (!settings.enabled || !isWatchPage() || !lastVideoId) return;

    let target = null;
    if (settings.preferredQuality !== 'auto') {
      target = settings.preferredQuality;
    } else {
      const code = yarDesiredQualityForDisplay(settings, displayState());
      target = code ? yarQualityAliasFor(code) : null;
    }
    if (!target) return;

    const signature = `${lastVideoId}_${target}`;
    if (signature === qualityRequestSignature) return;
    qualityRequestSignature = signature;

    window.postMessage(
      {
        type: YAR_CHANNEL.ACTION,
        action: YAR_CHANNEL.SET_QUALITY,
        payload: { quality: target }
      },
      window.location.origin
    );
    yarLog('要求畫質', target, `(螢幕 ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x)`);
  }

  /**
   * 視窗換螢幕或縮放後重新評估。
   *
   * 版面本身不需要這個（CSS 的 100vw/100vh 會自己跟上），但兩件事需要：
   * ① 畫質請求 —— 從 1710px 邏輯寬的內建螢幕移到 3840px 的 4K 上，該要的畫質不一樣
   * ② allowUpscale —— 螢幕容量改變會讓「影片畫質夠不夠」的答案翻轉
   *
   * 刻意不在這裡呼叫 syncBrowserWindow()：那會在使用者手動縮放視窗時反過來改動視窗尺寸。
   */
  function handleDisplayChange() {
    watchDisplayChange();
    applyPlayerLayout();

    /*
     * v2.3.0 讓畫質取決於視窗尺寸，而「同步調整瀏覽器視窗」又讓視窗尺寸取決於畫質 ——
     * 兩者相接就是一個閉環：改視窗 -> 換畫質 -> 又改視窗。單靠 lastSentWindowSize 去重擋不住，
     * 它只記得上一次，兩狀態來回震盪的簽章每次都不同（同一類問題見彈出視窗校正的震盪紀錄）。
     * 剛送出過視窗調整就先不重算畫質，等視窗安定下來、不再有 resize 事件為止。
     */
    if (settings.resizeMainWindow
      && Date.now() - lastWindowResizeAt < YAR_WINDOW_RESIZE_COOLDOWN_MS * 2) {
      return;
    }
    pushDesiredQuality();
  }

  /**
   * 監看 DPR 變化。移到不同縮放倍率的螢幕時（本機實測：內建 @2x → 4K @1x）
   * matchMedia 會觸發，但條件字串必須用當下的 dppx 重新綁定，否則只會觸發一次。
   */
  function watchDisplayChange() {
    if (typeof window.matchMedia !== 'function') return;
    if (displayQuery && typeof displayQuery.removeEventListener === 'function') {
      displayQuery.removeEventListener('change', handleDisplayChange);
    }
    try {
      displayQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      if (typeof displayQuery.addEventListener === 'function') {
        displayQuery.addEventListener('change', handleDisplayChange);
      }
    } catch (err) {
      displayQuery = null;   // 條件字串不受支援時就只靠 resize 事件
    }
  }

  window.addEventListener('resize', () => {
    if (displaySettleTimer) clearTimeout(displaySettleTimer);
    displaySettleTimer = setTimeout(() => {
      displaySettleTimer = null;
      handleDisplayChange();
    }, DISPLAY_SETTLE_MS);
  });

  watchDisplayChange();

  // ------------------------------------------------------- 瀏覽器視窗同步

  /** 量目前這個視窗的外框；計算與退路規則見 src/window-fit.js */
  function measuredWindowChrome() {
    return yarWindowChromeFrom(
      window.outerWidth, window.innerWidth,
      window.outerHeight, window.innerHeight
    );
  }

  /**
   * 組出「視窗尺寸請求」交給 service worker 去算最終尺寸（計算核心在 src/window-fit.js）。
   *
   * 這裡唯一的判斷是「量到的外框適不適用」：主視窗替尚未存在的彈出視窗算尺寸時，
   * 量到的是主視窗的分頁列與網址列，套用在彈出視窗上會整個算錯，只能先用估計值，
   * 待彈出視窗自己載入後再由閉環校正修正。
   */
  function windowFitRequest(isPopup) {
    return yarBuildFitRequest(settings, {
      quality: lastQuality,
      isPopup,
      measuredChrome: isPopup === isPopupPlayerWindow() ? measuredWindowChrome() : null,
      videoWidth: lastVideoW,
      videoHeight: lastVideoH
    });
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

    const fit = windowFitRequest(false);
    // 最終尺寸由 service worker 依真實螢幕算出，因此改用「請求內容」做去重簽章
    const signature = `${fit.playerWidth}_${fit.extraWidth}_${fit.extraHeight}_${fit.aspectRatio.toFixed(3)}`;
    if (signature === lastSentWindowSize) return;

    const now = Date.now();
    if (now - lastWindowResizeAt < YAR_WINDOW_RESIZE_COOLDOWN_MS) return;

    lastSentWindowSize = signature;
    lastWindowResizeAt = now;
    chrome.runtime.sendMessage(
      { action: YAR_MSG.RESIZE_WINDOW, fit },
      () => void chrome.runtime.lastError
    );
    yarLog('要求調整視窗尺寸', lastQuality, signature);
  }

  /**
   * 彈出視窗的閉環尺寸校正：量實際內容區 → 交給 yarPopupCalibrationTarget 算下一步 → 送出。
   * 幾何與「受限後只能送寬度」的不變量都在 src/window-fit.js；本函式只負責量測、記錄與傳送。
   */
  function calibratePopupWindow() {
    if (!isPopupPlayerWindow()) return;
    if (popupCalibrations >= POPUP_MAX_CALIBRATIONS) return;
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) return;

    // 受限是單向狀態：一旦成立就永久記住，不可以每輪重問（否則兩狀態無限震盪、視窗還會長大）
    if (!popupHeightCapped && lastRequestedOuter
      && yarWindowHeightWasCapped(lastRequestedOuter.height, window.outerHeight)) {
      popupHeightCapped = true;
    }

    const innerW = window.innerWidth;
    const innerH = window.innerHeight;
    const target = yarPopupCalibrationTarget({
      innerWidth: innerW,
      innerHeight: innerH,
      chromeWidth: window.outerWidth - innerW,
      chromeHeight: window.outerHeight - innerH,
      aspectRatio: yarAspectRatioOf(lastVideoW, lastVideoH),
      heightCapped: popupHeightCapped
    });
    if (!target) return;

    lastRequestedOuter = { width: target.width, height: target.height };
    lastSentWindowSize = `${target.width}x${target.height}`;
    popupCalibrations += 1;

    const payload = { action: YAR_MSG.RESIZE_WINDOW, width: target.width };
    if (!target.heightCapped) payload.height = target.height;

    chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    yarLog(
      '彈出視窗校正',
      `${innerW}x${innerH} -> 內容 ${target.innerWidth}x${target.innerHeight}`,
      target.heightCapped ? '(高度受限，改縮寬)' : ''
    );
  }

  /** 視窗尺寸與影片資訊都需要時間穩定，分幾輪校正到收斂；每支影片只排一次 */
  function scheduleWindowCalibration() {
    if (!isPopupPlayerWindow() || popupCalibrationScheduled) return;
    popupCalibrationScheduled = true;
    [400, 1200, 2500, 4000, 6000].forEach((delay) => setTimeout(calibratePopupWindow, delay));
  }

  // ------------------------------------------------ 主世界畫質事件接收

  /**
   * 決定版面要採用的畫質。升降畫質的判準見 src/quality-policy.js 的 yarShouldAdoptImmediately；
   * 這裡只負責 settle 計時器與狀態更新。
   * @returns {boolean} 是否需要立即重新套用版面
   */
  function adoptQuality(quality) {
    reportedQuality = quality;
    if (shrinkTimer) {
      clearTimeout(shrinkTimer);
      shrinkTimer = null;
    }
    if (yarShouldAdoptImmediately(quality, lastQuality)) {
      lastQuality = quality;
      return true;
    }
    shrinkTimer = setTimeout(() => {
      shrinkTimer = null;
      // 這段期間畫質又變了就不算數，交給後來那次事件處理
      if (reportedQuality !== quality || yarShouldAdoptImmediately(quality, lastQuality)) return;
      lastQuality = quality;
      applyPlayerLayout();
      syncBrowserWindow();
    }, QUALITY_SHRINK_SETTLE_MS);
    return false;
  }

  function handleQualityChange(event) {
    const detail = event.detail || {};
    if (!detail.quality) return;

    if (detail.videoId && detail.videoId !== lastVideoId) {
      lastVideoId = detail.videoId;
      lastSentWindowSize = '';
      popupCalibrations = 0;
      popupCalibrationScheduled = false;
      lastQuality = null;   // 換影片就重新開始比較，否則上一支的高畫質會鎖住新影片的尺寸
      availableQualities = [];   // 上一支影片的可用畫質不適用於新影片
    }

    /*
     * 可用畫質清單通常比第一次畫質回報晚幾秒才就緒，而它一旦到手就可能讓 allowUpscale 翻轉
     * （例如發現這支影片最高只有 1080p），因此清單本身的變化也要觸發重新套用版面。
     */
    const nextAvailable = Array.isArray(detail.availableQualities) ? detail.availableQualities : [];
    const availableChanged = nextAvailable.join() !== availableQualities.join();
    if (availableChanged) availableQualities = nextAvailable;

    const layoutChanged = adoptQuality(detail.quality);
    if (detail.videoWidth > 0 && detail.videoHeight > 0) {
      lastVideoW = detail.videoWidth;
      lastVideoH = detail.videoHeight;
    }

    if (layoutChanged || availableChanged) {
      applyPlayerLayout();
      if (layoutChanged) syncBrowserWindow();
    }
    pushDesiredQuality();
    scheduleWindowCalibration();
  }

  document.addEventListener(YAR_CHANNEL.QUALITY_CHANGED, handleQualityChange);

  // ---------------------------------------------------------------- SPA 導航

  function handlePageNavigation() {
    injectMainWorldScripts();
    askServiceWorkerIfPopupPlayer();
    if (!isWatchPage()) {
      clearStyle();
      if (shrinkTimer) {
        clearTimeout(shrinkTimer);
        shrinkTimer = null;
      }
      lastQuality = null;
      reportedQuality = null;
      lastVideoId = null;
      availableQualities = [];
      qualityRequestSignature = '';
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
      {
        action: YAR_MSG.OPEN_POPUP_PLAYER,
        videoId,
        startTime: video ? Math.floor(video.currentTime) : 0,
        fit: windowFitRequest(true)
      },
      () => void chrome.runtime.lastError
    );
  }

  function buildPopupButton() {
    const button = document.createElement('button');
    button.id = POPUP_BUTTON_ID;
    button.className = 'ytp-button';
    button.title = yarMessage('popupPlayerButton', 'Pop-out player');
    button.setAttribute('aria-label', button.title);

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

  /** 移除彈出按鈕並停止重試（用於事後才確認自己是彈出視窗的情況） */
  function removePopupButton() {
    if (buttonTimer) {
      clearTimeout(buttonTimer);
      buttonTimer = null;
    }
    const existing = document.getElementById(POPUP_BUTTON_ID);
    if (existing) existing.remove();
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
