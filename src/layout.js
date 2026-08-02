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
      ytd-watch-flexy #columns.ytd-watch-flexy,
      ytd-watch-flexy #primary.ytd-watch-flexy,
      ytd-watch-flexy #primary-inner,
      ytd-watch-flexy #secondary.ytd-watch-flexy {
        box-sizing: border-box !important;
      }`;
}

/** 兩欄版面（零留白）規則 — 僅在 YouTube 自己判定為兩欄時套用 */
function yarTwoColumnCss() {
  return `
      ytd-watch-flexy[is-two-columns_] #columns.ytd-watch-flexy {
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
      ytd-watch-flexy[is-two-columns_] #primary.ytd-watch-flexy,
      ytd-watch-flexy[is-two-columns_] #primary-inner {
        width: var(--yar-player-w) !important;
        max-width: var(--yar-player-w) !important;
        min-width: 0 !important;
        flex: none !important;
        margin-left: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      ytd-watch-flexy[is-two-columns_] #secondary.ytd-watch-flexy {
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
      ytd-watch-flexy #columns.ytd-watch-flexy {
        max-width: 100% !important;
        width: 100% !important;
        min-width: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        margin: 0 !important;
        padding: 0 ${YAR_LAYOUT.PAGE_PADDING / 2}px !important;
      }
      ytd-watch-flexy #primary.ytd-watch-flexy,
      ytd-watch-flexy #primary-inner,
      ytd-watch-flexy #secondary.ytd-watch-flexy {
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
      ytd-watch-flexy #secondary.ytd-watch-flexy {
        overflow-x: clip !important;
      }`;
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

  // 劇院模式一律單欄；其餘模式跟著 YouTube 自己的兩欄斷點走，
  // 視窗變窄而 YouTube 收成單欄時不再硬扣側欄寬度。
  const twoColumnOverride = isTheater
    ? ''
    : `
      ytd-watch-flexy[is-two-columns_] {
        --yar-player-w: ${twoColumnWidth};
      }`;

  return `
      /* 播放器尺寸來源：單一 custom property，高度一律 16:9 推導 */
      ytd-watch-flexy,
      ytd-watch-flexy[flexy] {
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
      ytd-watch-flexy[flexy] #player-container-outer.ytd-watch-flexy,
      ytd-watch-flexy[flexy] #player-container-inner.ytd-watch-flexy,
      ytd-watch-flexy[flexy] #player-container.ytd-watch-flexy,
      ytd-watch-flexy #player-container-outer,
      ytd-watch-flexy #player-container-inner,
      ytd-watch-flexy #player-container,
      ytd-watch-flexy #player,
      ytd-watch-flexy #ytd-player,
      ytd-watch-flexy #movie_player:not(.ytp-fullscreen),
      ytd-watch-flexy .html5-video-player:not(.ytp-fullscreen) {
        width: var(--yar-player-w) !important;
        height: var(--yar-player-h) !important;
        min-width: 0 !important;
        min-height: 0 !important;
        max-width: none !important;
        max-height: none !important;
        padding-top: 0 !important;
      }

      /* 讓 HTML5 視訊串流撐滿播放器容器，避免高度塌陷成 0px */
      ytd-watch-flexy .html5-video-container,
      ytd-watch-flexy .html5-main-video,
      ytd-watch-flexy video.video-stream,
      ytd-watch-flexy #movie_player video {
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
      ytd-watch-flexy #player,
      ytd-watch-flexy[theater] #player,
      ytd-watch-flexy[full-bleed-player] #player,
      ytd-watch-flexy #player-container,
      ytd-watch-flexy[theater] #player-container,
      ytd-watch-flexy[full-bleed-player] #player-container,
      ytd-watch-flexy #player-container-inner,
      ytd-watch-flexy #player-container-outer,
      ytd-watch-flexy #player-full-bleed-container,
      ytd-watch-flexy #full-bleed-container,
      ytd-watch-flexy #ytd-player,
      ytd-watch-flexy #movie_player {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }

      /*
       * 電影感光暈 (#cinematics) 是一張被 scale(1.5, 2) 放大的 canvas，刻意溢出播放器邊界。
       * 播放器被我們放大後，它會一併撐破視窗寬度而長出橫向捲軸，因此就地夾住水平方向。
       * 用 clip 而非 hidden：不建立捲動容器，垂直方向的光暈效果仍保留。
       */
      ytd-watch-flexy #player,
      ytd-watch-flexy #cinematics-container,
      ytd-watch-flexy #cinematics {
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
