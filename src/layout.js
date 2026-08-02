/**
 * layout.js — 播放器尺寸 CSS 產生器（純函式，無副作用）
 * Pure CSS builder for the watch-page player layout.
 *
 * Created: 2026-08-02
 * 依賴 (depends on): src/config.js 的 YAR_LAYOUT / YAR_QUALITY_WIDTH
 *
 * 設計要點：寬度以 CSS min() 表示，因此視窗縮放時瀏覽器會自行重算，
 * 不需要 JS 監聽 resize，也不會像 screen.availWidth 那樣誤判成實體螢幕尺寸。
 */

/* eslint-disable no-unused-vars */

/** 單欄版面（YouTube 窄視窗或劇院模式）只需扣掉頁面內距與捲軸 */
function yarReserveSingleColumn() {
  return YAR_LAYOUT.PAGE_PADDING + YAR_LAYOUT.SCROLLBAR_RESERVE;
}

/** 兩欄版面另需扣掉推薦影片側欄與欄間距 */
function yarReserveTwoColumn(removeSideGaps) {
  const gap = removeSideGaps ? YAR_LAYOUT.COLUMN_GAP : YAR_LAYOUT.COLUMN_GAP * 2;
  return yarReserveSingleColumn() + YAR_LAYOUT.SIDEBAR_WIDTH + gap;
}

/**
 * 產生播放器寬度的 CSS 運算式。
 * @param {{resizeMode: string}} settings
 * @param {string} quality YouTube 內部畫質代碼，例如 hd2160
 * @param {number} reserveW 需從視窗寬度扣除的水平空間 (px)
 * @returns {string} 可直接指派給 custom property 的 CSS 值
 */
function yarBuildWidthExpression(settings, quality, reserveW) {
  const reserveH = YAR_LAYOUT.MASTHEAD_HEIGHT + YAR_LAYOUT.VERTICAL_MARGIN;

  const byViewportWidth = `calc(100vw - ${reserveW}px)`;
  const byViewportHeight = `calc((100vh - ${reserveH}px) * 16 / 9)`;

  const caps = [byViewportWidth, byViewportHeight];
  if (settings.resizeMode === 'autoByQuality') {
    const nativeWidth = YAR_QUALITY_WIDTH[quality];
    if (nativeWidth) caps.unshift(`${nativeWidth}px`);
  }

  return `max(${YAR_LAYOUT.MIN_PLAYER_WIDTH}px, min(${caps.join(', ')}))`;
}

/**
 * #columns 在 YouTube 預設是 content-box，直接給 width:100% 再加 padding 會溢出視窗，
 * 因此所有被我們接管寬度的容器一律改成 border-box。
 */
function yarBorderBoxCss() {
  return `
      ytd-watch-flexy:not([full-bleed-player]) #columns.ytd-watch-flexy,
      ytd-watch-flexy:not([full-bleed-player]) #primary.ytd-watch-flexy,
      ytd-watch-flexy:not([full-bleed-player]) #primary-inner,
      ytd-watch-flexy:not([full-bleed-player]) #secondary.ytd-watch-flexy {
        box-sizing: border-box !important;
      }`;
}

/** 兩欄版面（零留白）規則 — 僅在 YouTube 自己判定為兩欄時套用 */
function yarTwoColumnCss() {
  return `
      ytd-watch-flexy[is-two-columns_]:not([theater]):not([full-bleed-player]) #columns.ytd-watch-flexy {
        max-width: none !important;
        width: 100% !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        display: flex !important;
        flex-direction: row !important;
        justify-content: flex-start !important;
        align-items: flex-start !important;
        gap: ${YAR_LAYOUT.COLUMN_GAP}px !important;
        padding: 0 ${YAR_LAYOUT.PAGE_PADDING / 2}px !important;
      }
      ytd-watch-flexy[is-two-columns_]:not([theater]):not([full-bleed-player]) #primary.ytd-watch-flexy,
      ytd-watch-flexy[is-two-columns_]:not([theater]):not([full-bleed-player]) #primary-inner {
        width: var(--yar-player-w) !important;
        max-width: var(--yar-player-w) !important;
        min-width: 0 !important;
        flex: none !important;
        margin-left: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      ytd-watch-flexy[is-two-columns_]:not([theater]):not([full-bleed-player]) #secondary.ytd-watch-flexy {
        width: ${YAR_LAYOUT.SIDEBAR_WIDTH}px !important;
        min-width: 0 !important;
        max-width: ${YAR_LAYOUT.SIDEBAR_WIDTH}px !important;
        flex: none !important;
        margin-right: 0 !important;
        margin-top: 0 !important;
        padding-left: 0 !important;
        padding-top: 0 !important;
        top: 0 !important;
        position: relative !important;
      }`;
}

/** 劇院模式：主欄滿寬、推薦欄移到下方 */
function yarTheaterColumnCss() {
  return `
      ytd-watch-flexy:not([full-bleed-player]) #columns.ytd-watch-flexy {
        max-width: 100% !important;
        width: 100% !important;
        min-width: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        margin: 0 !important;
        padding: 0 ${YAR_LAYOUT.PAGE_PADDING / 2}px !important;
      }
      ytd-watch-flexy:not([full-bleed-player]) #primary.ytd-watch-flexy,
      ytd-watch-flexy:not([full-bleed-player]) #primary-inner,
      ytd-watch-flexy:not([full-bleed-player]) #secondary.ytd-watch-flexy {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        flex: none !important;
        margin: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        top: 0 !important;
        position: relative !important;
      }
      /*
       * 推薦欄變成滿寬單欄後，內部的 Shorts 橫向清單會以 transform 排版而超出容器，
       * 造成整頁出現橫向捲軸。用 overflow-x: clip 就地夾住（不建立捲動容器，
       * 因此不影響 position: sticky；YouTube 的彈出選單掛在 body 的 popup container，不會被裁切）。
       */
      ytd-watch-flexy:not([full-bleed-player]) #secondary.ytd-watch-flexy {
        overflow-x: clip !important;
      }`;
}

/**
 * 彈出式播放器視窗專用樣式：把 watch 頁收成一個只剩播放器的視窗。
 * 走這條路而非 youtube.com/embed/，是因為 embed 路徑在頂層視窗會被 YouTube 拒絕
 * （錯誤 153），而這裡完全不依賴嵌入政策。
 * @returns {string}
 */
function yarBuildPopupPlayerCss() {
  return `
      /* 只留播放器：頁首、推薦欄、影片資訊、留言、側邊選單全部收起 */
      :root[${YAR_POPUP_ATTRIBUTE}] #masthead-container,
      :root[${YAR_POPUP_ATTRIBUTE}] ytd-masthead,
      :root[${YAR_POPUP_ATTRIBUTE}] tp-yt-app-drawer#guide,
      :root[${YAR_POPUP_ATTRIBUTE}] #secondary,
      :root[${YAR_POPUP_ATTRIBUTE}] #below,
      :root[${YAR_POPUP_ATTRIBUTE}] ytd-watch-metadata,
      :root[${YAR_POPUP_ATTRIBUTE}] #chat,
      :root[${YAR_POPUP_ATTRIBUTE}] ytd-comments,
      :root[${YAR_POPUP_ATTRIBUTE}] #player-full-bleed-container ~ *,
      :root[${YAR_POPUP_ATTRIBUTE}] ytd-mini-guide-renderer {
        display: none !important;
      }

      :root[${YAR_POPUP_ATTRIBUTE}] body,
      :root[${YAR_POPUP_ATTRIBUTE}] ytd-app,
      :root[${YAR_POPUP_ATTRIBUTE}] #content.ytd-app,
      :root[${YAR_POPUP_ATTRIBUTE}] #page-manager.ytd-app,
      :root[${YAR_POPUP_ATTRIBUTE}] ytd-watch-flexy,
      :root[${YAR_POPUP_ATTRIBUTE}] #columns.ytd-watch-flexy,
      :root[${YAR_POPUP_ATTRIBUTE}] #primary.ytd-watch-flexy,
      :root[${YAR_POPUP_ATTRIBUTE}] #primary-inner {
        margin: 0 !important;
        padding: 0 !important;
        max-width: none !important;
        width: 100% !important;
        overflow: hidden !important;
      }

      :root[${YAR_POPUP_ATTRIBUTE}] #player-container-outer,
      :root[${YAR_POPUP_ATTRIBUTE}] #player-container-inner,
      :root[${YAR_POPUP_ATTRIBUTE}] #player-container,
      :root[${YAR_POPUP_ATTRIBUTE}] #player-full-bleed-container,
      :root[${YAR_POPUP_ATTRIBUTE}] #player,
      :root[${YAR_POPUP_ATTRIBUTE}] #ytd-player,
      :root[${YAR_POPUP_ATTRIBUTE}] #movie_player:not(.ytp-fullscreen),
      :root[${YAR_POPUP_ATTRIBUTE}] .html5-video-player:not(.ytp-fullscreen) {
        width: 100vw !important;
        height: 100vh !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        top: 0 !important;
        left: 0 !important;
        position: relative !important;
      }

      :root[${YAR_POPUP_ATTRIBUTE}] .html5-video-container,
      :root[${YAR_POPUP_ATTRIBUTE}] video.video-stream {
        width: 100% !important;
        height: 100% !important;
        top: 0 !important;
        left: 0 !important;
        object-fit: contain !important;
      }
    `;
}

/**
 * 產生完整的動態樣式表內容。
 * @param {object} settings 已正規化的設定
 * @param {string} quality YouTube 內部畫質代碼
 * @returns {string} CSS；resizeMode 為 'default' 或未啟用時回傳空字串
 */
function yarBuildPlayerCss(settings, quality) {
  if (!settings.enabled || settings.resizeMode === 'default') return '';

  const isTheater = settings.resizeMode === 'theater';
  const singleColumnWidth = yarBuildWidthExpression(settings, quality, yarReserveSingleColumn());
  const twoColumnWidth = yarBuildWidthExpression(settings, quality, yarReserveTwoColumn(settings.removeSideGaps));

  // 只有在我們實際接管欄位寬度時，才需要一併修正 box-sizing
  let columnCss = '';
  if (isTheater) {
    columnCss = yarBorderBoxCss() + yarTheaterColumnCss();
  } else if (settings.removeSideGaps) {
    columnCss = yarBorderBoxCss() + yarTwoColumnCss();
  }

  /*
   * 本檔所有選擇器都帶 :not([full-bleed-player])：YouTube 原生劇院／滿版模式本來就是
   * 滿版貼合，我們一旦介入就會改到 --ytd-watch-flexy-player-width，而 YouTube 拿同一個
   * 變數去算 #primary 的寬度，於是 primary + secondary 會超出視窗長出橫向捲軸。
   * 曾經只排除播放器尺寸而沒排除變數，結果是播放器縮成兩欄寬靠左、右側一大片黑邊。
   */
  const twoColumnOverride = isTheater
    ? ''
    : `
      ytd-watch-flexy[is-two-columns_]:not([theater]):not([full-bleed-player]) {
        --yar-player-w: ${twoColumnWidth};
      }`;

  return `
      /* 播放器尺寸來源：單一 custom property，高度一律 16:9 推導 */
      ytd-watch-flexy:not([full-bleed-player]),
      ytd-watch-flexy[flexy]:not([full-bleed-player]) {
        --yar-player-w: ${singleColumnWidth};
        --yar-player-h: calc(var(--yar-player-w) * 9 / 16);
        --ytd-watch-flexy-player-width: var(--yar-player-w) !important;
        --ytd-watch-flexy-player-height: var(--yar-player-h) !important;
        --ytd-watch-flexy-min-player-height: var(--yar-player-h) !important;
        --ytd-watch-flexy-max-player-width-wide-screen: none !important;
        --yt-player-width: var(--yar-player-w) !important;
        --yt-player-height: var(--yar-player-h) !important;
      }
${twoColumnOverride}

      /* 播放器容器精確 16:9 尺寸 — 僅限 watch 頁 */
      ytd-watch-flexy[flexy]:not([full-bleed-player]) #player-container-outer.ytd-watch-flexy,
      ytd-watch-flexy[flexy]:not([full-bleed-player]) #player-container-inner.ytd-watch-flexy,
      ytd-watch-flexy[flexy]:not([full-bleed-player]) #player-container.ytd-watch-flexy,
      ytd-watch-flexy:not([full-bleed-player]) #player-container-outer,
      ytd-watch-flexy:not([full-bleed-player]) #player-container-inner,
      ytd-watch-flexy:not([full-bleed-player]) #player-container,
      ytd-watch-flexy:not([full-bleed-player]) #player,
      ytd-watch-flexy:not([full-bleed-player]) #ytd-player,
      ytd-watch-flexy:not([full-bleed-player]) #movie_player:not(.ytp-fullscreen),
      ytd-watch-flexy:not([full-bleed-player]) .html5-video-player:not(.ytp-fullscreen) {
        width: var(--yar-player-w) !important;
        height: var(--yar-player-h) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        padding-top: 0 !important;
      }

      /* 讓 HTML5 視訊串流撐滿播放器容器，避免高度塌陷成 0px */
      ytd-watch-flexy:not([full-bleed-player]) .html5-video-container,
      ytd-watch-flexy:not([full-bleed-player]) .html5-main-video,
      ytd-watch-flexy:not([full-bleed-player]) video.video-stream,
      ytd-watch-flexy:not([full-bleed-player]) #movie_player video {
        width: 100% !important;
        height: 100% !important;
        top: 0 !important;
        left: 0 !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: contain !important;
      }

      /* 確保各種 Polymer 模式下播放器容器都保持可見 */
      ytd-watch-flexy:not([full-bleed-player]) #player,
      ytd-watch-flexy[theater]:not([full-bleed-player]) #player,
      ytd-watch-flexy[full-bleed-player]:not([full-bleed-player]) #player,
      ytd-watch-flexy:not([full-bleed-player]) #player-container,
      ytd-watch-flexy[theater]:not([full-bleed-player]) #player-container,
      ytd-watch-flexy[full-bleed-player]:not([full-bleed-player]) #player-container,
      ytd-watch-flexy:not([full-bleed-player]) #player-container-inner,
      ytd-watch-flexy:not([full-bleed-player]) #player-container-outer,
      ytd-watch-flexy:not([full-bleed-player]) #player-full-bleed-container,
      ytd-watch-flexy:not([full-bleed-player]) #full-bleed-container,
      ytd-watch-flexy:not([full-bleed-player]) #ytd-player,
      ytd-watch-flexy:not([full-bleed-player]) #movie_player {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }


      /*
       * 電影感光暈 (#cinematics) 是一張被 scale(1.5, 2) 放大的 canvas，刻意溢出播放器邊界。
       * 播放器被我們放大後，它會一併撐破視窗寬度而長出橫向捲軸，因此就地夾住水平方向。
       * 用 clip 而非 hidden：不建立捲動容器，垂直方向的光暈效果仍保留。
       */
      ytd-watch-flexy:not([full-bleed-player]) #player,
      ytd-watch-flexy:not([full-bleed-player]) #cinematics-container,
      ytd-watch-flexy:not([full-bleed-player]) #cinematics {
        overflow-x: clip !important;
        max-width: 100% !important;
      }

      /* YouTube 設定選單需壓在放大後的播放器之上 */
      .ytp-popup,
      .ytp-settings-menu {
        z-index: 999999 !important;
      }

      /* 左側抽屜選單：實心背景 + 提高堆疊層級，避免透出播放器 */
      tp-yt-app-drawer#guide,
      ytd-guide-renderer,
      #guide-wrapper,
      #guide-content {
        background-color: var(--yt-spec-base-background, #0f0f0f) !important;
        z-index: 99999 !important;
      }
${columnCss}
    `;
}
