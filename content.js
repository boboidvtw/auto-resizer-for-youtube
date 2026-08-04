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
   */

  /**
   * 這台螢幕能讓播放器長到多大（CSS px）。
   * 刻意帶 allowUpscale=true：問的是「螢幕的容量」，不該被目前畫質的原生寬度反過來限制，
   * 否則會變成「因為現在是 1080p，所以只需要 1080p」的自我實現迴圈。
   */
  function displayCeilingWidth() {
    return yarPlayerWidthFor(
      settings,
      lastQuality || 'hd1080',
      window.innerWidth,
      window.innerHeight,
      { allowUpscale: true }
    );
  }

  /** 依螢幕實體像素（CSS 寬 × DPR）算出應該要的畫質；未啟用時回傳 null */
  function desiredQualityForDisplay() {
    if (!settings.enabled || !settings.displayAwareQuality) return null;
    if (settings.resizeMode === 'default' || isPopupPlayerWindow()) return null;
    const ceiling = displayCeilingWidth();
    if (!ceiling) return null;
    return yarQualityForPlayer(ceiling, window.devicePixelRatio, settings.autoQualityCeiling);
  }

  /**
   * 判斷「影片最高能給到哪」時可用的清單。
   * 使用者手動指定畫質時，那個畫質就是實質上限 —— 此時若螢幕還有餘裕，
   * 放大是唯一能填滿畫面的辦法（使用者選的策略是「畫質優先、不夠才放大」）。
   */
  function effectiveAvailableQualities() {
    if (settings.preferredQuality !== 'auto') {
      const pinned = YAR_QUALITY_ALIAS[settings.preferredQuality];
      return pinned && pinned !== 'auto' ? [pinned] : availableQualities;
    }
    return availableQualities;
  }

  /** 版面情境：只有「已是影片最高畫質仍填不滿螢幕」時才允許超過原生解析度放大 */
  function layoutContext() {
    return {
      allowUpscale: yarShouldUpscale(desiredQualityForDisplay(), effectiveAvailableQualities())
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
    const css = yarBuildPlayerCss(settings, lastQuality || 'hd1080', layoutContext());
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
      const code = desiredQualityForDisplay();
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
   * 組出「視窗尺寸請求」交給 service worker 去算。
   *
   * 這裡刻意**不**碰 `window.screen.avail*`。實測（2026-08-04，Brave，同一實例同一時刻）：
   *   YouTube 頁面          screen 1680x1050、screenX 8   ← 被指紋防護竄改
   *   擴充功能 service worker  chrome.system.display 1710x1107 與 3840x2160  ← 真值
   * 也就是說頁面端量到的螢幕尺寸是假的。在單螢幕上誤差還小，但要替 3840x2160 的外接
   * 螢幕算視窗時，用被竄改成 1680 的數字會算出一個小一半的視窗。
   * 真正知道螢幕的是 service worker，因此由它負責夾擠與定位，這裡只提供內容需求。
   *
   * @returns {{playerWidth:number, extraWidth:number, extraHeight:number, aspectRatio:number}}
   */
  function windowFitRequest(isPopup) {
    const playerWidth = YAR_QUALITY_WIDTH[lastQuality] || YAR_QUALITY_WIDTH.hd1080;
    // 實測值只在「要調整的視窗就是自己」時才適用。主視窗替尚未存在的彈出視窗算尺寸時，
    // 量到的是主視窗的分頁列與網址列，套用在彈出視窗上會整個算錯，只能先用估計值，
    // 待彈出視窗自己載入後再校正。
    const measured = isPopup === isPopupPlayerWindow() ? measuredWindowChrome() : null;

    // 一般視窗：側欄不再固定佔住播放器右側（放不下就換行到下方，見 layout.js 的
    // yarColumnsCss），所以只需扣掉頁面內距與捲軸，與 CSS 的寬度運算式同一套假設。
    const contentExtraWidth = isPopup ? 0 : yarReservePageWidth(settings.removeSideGaps);
    const fallbackChromeHeight = isPopup
      ? YAR_LAYOUT.POPUP_CHROME_HEIGHT
      : YAR_LAYOUT.MASTHEAD_HEIGHT + YAR_LAYOUT.WINDOW_CHROME_HEIGHT;

    return {
      playerWidth,
      extraWidth: contentExtraWidth + (measured ? measured.width : 0),
      extraHeight: measured ? measured.height : fallbackChromeHeight,
      aspectRatio: currentAspectRatio()
    };
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

  /** 畫質代碼對應的原生寬度，用來比較「哪個比較大」 */
  function qualityWidth(quality) {
    return YAR_QUALITY_WIDTH[quality] || 0;
  }

  /**
   * 決定版面要採用的畫質。
   * 升畫質立即跟進（使用者期待的就是變大）；降畫質先等 QUALITY_SHRINK_SETTLE_MS，
   * 期間又升回去就不縮，藉此濾掉 ABR 抖動。
   * @returns {boolean} 是否需要立即重新套用版面
   */
  function adoptQuality(quality) {
    reportedQuality = quality;
    if (shrinkTimer) {
      clearTimeout(shrinkTimer);
      shrinkTimer = null;
    }
    if (!lastQuality || qualityWidth(quality) >= qualityWidth(lastQuality)) {
      lastQuality = quality;
      return true;
    }
    shrinkTimer = setTimeout(() => {
      shrinkTimer = null;
      // 這段期間畫質又變了就不算數，交給後來那次事件處理
      if (reportedQuality !== quality || qualityWidth(quality) >= qualityWidth(lastQuality)) return;
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
