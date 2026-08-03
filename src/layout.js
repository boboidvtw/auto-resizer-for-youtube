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

/**
 * 選擇器前綴。原生滿版（full-bleed）一律不介入；欄位版面另外排除原生劇院，
 * 因為那兩種模式下 YouTube 自己就是滿版貼合，我們一介入反而會撐破視窗。
 */
const YAR_SCOPE_PLAYER = 'ytd-watch-flexy:not([full-bleed-player])';
const YAR_SCOPE_COLUMNS = 'ytd-watch-flexy:not([theater]):not([full-bleed-player])';

/** 頁面左右內距（零留白模式下歸零）＋ 捲軸保留 */
function yarReservePageWidth(removeSideGaps) {
  const padding = removeSideGaps ? 0 : YAR_LAYOUT.PAGE_PADDING;
  return padding + YAR_LAYOUT.SCROLLBAR_RESERVE;
}

/** 欄間距：零留白模式下仍需留一點，否則側欄會貼上播放器 */
function yarColumnGap(removeSideGaps) {
  return removeSideGaps ? YAR_LAYOUT.COLUMN_GAP : YAR_LAYOUT.COLUMN_GAP * 2;
}

/**
 * 產生播放器寬度的 CSS 運算式。
 *
 * 這裡**刻意不扣側欄寬度**。曾經扣了 400px 側欄 + 間距（共 472px），結果 1600px 視窗上
 * 播放器只能長到 1128px —— 那正好就是 YouTube 原生兩欄版面的寬度，也就是說「自動調整」
 * 相對原生只差 16px，肉眼完全看不出來，等於整個功能沒有作用（實測 default 1112 vs
 * autoByQuality 1128）。而且不論 4K 還是 720p 都被同一個 472px 夾在同一個尺寸，
 * autoByQuality 與 fitWindow 產生的 CSS 一模一樣，模式選單形同虛設。
 *
 * 正確的順序是：**先讓播放器長到視窗（高度）允許的最大值，側欄再撿剩下的空間**；
 * 剩餘空間不足以放下側欄時，由 #columns 的 flex-wrap 自動把側欄換到播放器下方
 * （見 yarColumnsCss）。因此這條運算式只需扣掉頁面內距與捲軸。
 *
 * @param {{resizeMode: string, removeSideGaps: boolean}} settings
 * @param {string} quality YouTube 內部畫質代碼，例如 hd2160
 * @returns {string} 可直接指派給 custom property 的 CSS 值
 */
function yarBuildWidthExpression(settings, quality) {
  const reserveW = yarReservePageWidth(settings.removeSideGaps);
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
function yarBorderBoxCss(scope) {
  return `
      ${scope} #columns.ytd-watch-flexy,
      ${scope} #primary.ytd-watch-flexy,
      ${scope} #primary-inner,
      ${scope} #secondary.ytd-watch-flexy {
        box-sizing: border-box !important;
      }`;
}

/**
 * 欄位版面：播放器優先取得空間，推薦側欄撿剩下的，放不下就自動換到下方。
 *
 * 關鍵是 `flex-flow: row wrap` + 側欄 `flex: 1 1 400px`：
 * - 播放器右側還剩得下 400px → 側欄留在同一列（一般兩欄版面）
 * - 剩不下 → 側欄自己換行，並因 flex-grow 撐滿整列（等同劇院版面）
 *
 * 這個換行判斷交給瀏覽器做，才不需要 JS 監聽 resize，縮放視窗時也會即時跟著切換。
 * 舊版是「先扣 400px 側欄再算播放器」，等於永遠鎖死在原生兩欄尺寸（見
 * yarBuildWidthExpression 的說明）。
 *
 * 不再依賴 `[is-two-columns_]` 這個 Polymer 私有屬性：換行由 flex 決定，
 * 窄視窗與寬視窗共用同一組規則，少一個會被 YouTube 改名弄壞的外部相依。
 */
function yarColumnsCss(removeSideGaps) {
  const scope = YAR_SCOPE_COLUMNS;
  const gap = yarColumnGap(removeSideGaps);
  const sidePadding = removeSideGaps ? 0 : YAR_LAYOUT.PAGE_PADDING / 2;

  return `
      /*
       * min-width 必須歸零。YouTube 自己用 --ytd-watch-flexy-player-width 去算 #columns 的
       * min-width（實測播放器 1392px 時算出 1760px），播放器一放大就會把整頁撐出橫向捲軸，
       * 側欄也因此永遠無法換行 —— min-width 撐著，flex 容器根本不會覺得空間不夠。
       */
      ${scope} #columns.ytd-watch-flexy {
        max-width: none !important;
        width: 100% !important;
        min-width: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        display: flex !important;
        flex-flow: row wrap !important;
        /* 側欄換到下方後，播放器若靠左會在右邊留一條空白；置中才不會看起來歪一邊 */
        justify-content: center !important;
        align-items: flex-start !important;
        gap: ${gap}px !important;
        padding: 0 ${sidePadding}px !important;
      }
      ${scope} #primary.ytd-watch-flexy,
      ${scope} #primary-inner {
        width: var(--yar-player-w) !important;
        max-width: 100% !important;
        min-width: 0 !important;
        flex: 0 0 auto !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      /* flex-basis 給側欄原本的寬度：擠得下就並排，擠不下就換行後撐滿 */
      ${scope} #secondary.ytd-watch-flexy {
        flex: 1 1 ${YAR_LAYOUT.SIDEBAR_WIDTH}px !important;
        min-width: min(${YAR_LAYOUT.SIDEBAR_WIDTH}px, 100%) !important;
        max-width: none !important;
        width: auto !important;
        margin-right: 0 !important;
        margin-top: 0 !important;
        padding-left: 0 !important;
        padding-top: 0 !important;
        top: 0 !important;
        position: relative !important;
        /*
         * 側欄換行後會變成滿寬，內部的 Shorts 橫向清單以 transform 排版而超出容器，
         * 整頁就會長出橫向捲軸。用 clip 就地夾住（不建立捲動容器，不影響 sticky）。
         */
        overflow-x: clip !important;
      }`;
}

/**
 * 劇院模式：主欄滿寬、推薦欄移到下方。
 * 內距必須與 yarReservePageWidth 的假設一致，否則播放器會比容器寬而溢出。
 */
function yarTheaterColumnCss(removeSideGaps) {
  const sidePadding = removeSideGaps ? 0 : YAR_LAYOUT.PAGE_PADDING / 2;
  const scope = YAR_SCOPE_COLUMNS;
  return `
      ${scope} #columns.ytd-watch-flexy {
        max-width: 100% !important;
        width: 100% !important;
        min-width: 0 !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        margin: 0 !important;
        padding: 0 ${sidePadding}px !important;
      }
      ${scope} #primary.ytd-watch-flexy,
      ${scope} #primary-inner,
      ${scope} #secondary.ytd-watch-flexy {
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
      ${scope} #secondary.ytd-watch-flexy {
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
  const playerWidth = yarBuildWidthExpression(settings, quality);

  /*
   * 欄位版面一律接管。曾經只在 removeSideGaps 開啟時才套，但播放器寬度變數
   * （--ytd-watch-flexy-player-width）是 YouTube 用來算 #primary 寬度的同一個變數，
   * 放大播放器卻不接管欄位，#primary + 側欄就會直接溢出視窗。
   * removeSideGaps 現在只決定內距與欄間距要不要歸零。
   */
  const columnCss = yarBorderBoxCss(YAR_SCOPE_COLUMNS) + (isTheater
    ? yarTheaterColumnCss(settings.removeSideGaps)
    : yarColumnsCss(settings.removeSideGaps));

  /*
   * 本檔所有選擇器都帶 :not([full-bleed-player])：YouTube 原生劇院／滿版模式本來就是
   * 滿版貼合，我們一旦介入就會改到 --ytd-watch-flexy-player-width，而 YouTube 拿同一個
   * 變數去算 #primary 的寬度，於是 primary + secondary 會超出視窗長出橫向捲軸。
   * 曾經只排除播放器尺寸而沒排除變數，結果是播放器縮成兩欄寬靠左、右側一大片黑邊。
   */
  return `
      /* 播放器尺寸來源：單一 custom property，高度一律 16:9 推導 */
      ytd-watch-flexy:not([full-bleed-player]),
      ytd-watch-flexy[flexy]:not([full-bleed-player]) {
        --yar-player-w: ${playerWidth};
        --yar-player-h: calc(var(--yar-player-w) * 9 / 16);
        --ytd-watch-flexy-player-width: var(--yar-player-w) !important;
        --ytd-watch-flexy-player-height: var(--yar-player-h) !important;
        --ytd-watch-flexy-min-player-height: var(--yar-player-h) !important;
        --ytd-watch-flexy-max-player-width-wide-screen: none !important;
        --yt-player-width: var(--yar-player-w) !important;
        --yt-player-height: var(--yar-player-h) !important;
      }

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

      /*
       * 影片標題下方那排按鈕 (#bottom-row) 用 margin: 0 -6px 外擴，比容器寬 12px。
       * YouTube 原本靠頁面兩側的 16px 內距吸收；零留白模式把內距歸零後就會露出來，
       * 整頁多出 12px 橫向捲軸。同樣用 clip 就地夾住（負邊界只是觸控回饋區，看不到差別）。
       */
      ytd-watch-flexy:not([full-bleed-player]) #primary-inner {
        overflow-x: clip !important;
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
