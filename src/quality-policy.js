/**
 * quality-policy.js — 「這台螢幕現在該要什麼畫質、版面能不能放大」的決策（純函式，無副作用）
 * Pure decisions for display-aware quality selection and upscale permission.
 *
 * Created: 2026-08-06
 * 依賴 (depends on): src/config.js（yarQualityWidthOf）、src/display.js
 *                    （yarQualityForPlayer / yarShouldUpscale）、src/layout.js（yarPlayerWidthFor）、
 *                    src/window-fit.js（yarAspectRatioOf）—— 故 manifest 中須排在 window-fit 之後
 * 載入端 (loaded by): content script (isolated world)
 *
 * 為什麼要從 content.js 抽出來：
 * 這幾個判斷原本埋在 content.js 的 IIFE 裡直接讀模組層級變數（settings / lastQuality /
 * availableQualities / window.*），除了開一個真的瀏覽器之外沒有任何辦法驗證。抽成純函式後，
 * 「Retina 上要不要拉高畫質」「影片只有 1080p 時該不該放大」這類決策就能在單元測試裡守住，
 * 而 content.js 只留下 DOM 與 chrome API 的編排。
 */

/* eslint-disable no-unused-vars */

/**
 * 還沒收到任何畫質回報時，用來探測「螢幕容量」的假設畫質。
 * 值本身不重要（yarDisplayCeilingWidth 一律以 allowUpscale 求值，不會被它夾住），
 * 但必須是合法代碼，否則 layout.js 會拿不到原生寬度。
 */
const YAR_CEILING_PROBE_QUALITY = 'hd1080';

/**
 * 這台螢幕能讓播放器長到多大（CSS px）。
 *
 * 刻意固定帶 allowUpscale：問的是「螢幕的容量」，不該被目前畫質的原生寬度反過來限制，
 * 否則會變成「因為現在是 1080p，所以只需要 1080p」的自我實現迴圈，螢幕感知永遠拉不高畫質。
 *
 * ⚠️ 這裡**刻意不帶 aspectRatio**，容量一律以 16:9 估算 —— 雖然版面本身（yarBuildPlayerCss）
 * 已經改為跟隨影片長寬比。這不是漏接：只把長寬比接進來會讓直式影片**要到更低的畫質**。
 * 原因是下游的 yarQualityForPlayer 比對的是 YAR_QUALITY_WIDTH（16:9 的寬度表），
 * 而直式影片的「720p」寬度只有 720。實測一支 720x1280 的影片：播放器 459 CSS × DPR 2
 * = 918 實體像素，若把容量估成 459，會挑到 hd720（720 寬）而不足以餵滿 918。
 * 要真的修正，yarQualityForPlayer 也得一起變成長寬比感知（見 memory/project_context.md 待辦）。
 * 在那之前維持 16:9 估算：方向是「寧可多要一點畫質」，不會讓畫面變糊。
 *
 * @param {object} settings 已正規化的設定
 * @param {string|null} quality 目前版面採用的畫質；未知時用 YAR_CEILING_PROBE_QUALITY
 * @param {{width:number, height:number}} viewport window.innerWidth / innerHeight
 * @returns {number|null} viewport 無效時回傳 null
 */
function yarDisplayCeilingWidth(settings, quality, viewport) {
  const vp = viewport && typeof viewport === 'object' ? viewport : {};
  return yarPlayerWidthFor(
    settings,
    quality || YAR_CEILING_PROBE_QUALITY,
    vp.width,
    vp.height,
    { allowUpscale: true }
  );
}

/**
 * 依螢幕的實體像素（CSS 寬 × devicePixelRatio）算出應該向 YouTube 要的畫質。
 *
 * 三種情況一律不干預，回傳 null：
 * - 功能停用，或使用者關掉「依螢幕自動拉高畫質」
 * - default 模式（我們一行 CSS 都不出，自然也不該去改畫質）
 * - 彈出式播放器（尺寸由閉環校正負責，不走螢幕感知這條路）
 *
 * @param {object} settings 已正規化的設定
 * @param {{quality:?string, viewport:object, dpr:?number, isPopupPlayer:boolean}} state
 * @returns {string|null} YouTube 內部畫質代碼
 */
function yarDesiredQualityForDisplay(settings, state) {
  if (!settings || !settings.enabled || !settings.displayAwareQuality) return null;
  const s = state && typeof state === 'object' ? state : {};
  if (settings.resizeMode === 'default' || s.isPopupPlayer) return null;

  const ceiling = yarDisplayCeilingWidth(settings, s.quality, s.viewport);
  if (!ceiling) return null;
  return yarQualityForPlayer(ceiling, s.dpr, settings.autoQualityCeiling);
}

/**
 * 判斷「這支影片最高能給到哪」時可用的畫質清單。
 *
 * 使用者手動指定畫質時，那個畫質就是實質上限——此時若螢幕還有餘裕，放大是唯一能填滿畫面的
 * 辦法（使用者選的策略本來就是「畫質優先、不夠才放大」）。
 *
 * @param {object} settings 已正規化的設定
 * @param {Array<string>} availableQualities 主世界 getAvailableQualityLevels() 的回報
 * @returns {Array<string>} 全新陣列或原輸入，不修改輸入
 */
function yarEffectiveAvailableQualities(settings, availableQualities) {
  const available = Array.isArray(availableQualities) ? availableQualities : [];
  if (!settings || settings.preferredQuality === 'auto') return available;

  const pinned = YAR_QUALITY_ALIAS[settings.preferredQuality];
  return pinned && pinned !== 'auto' ? [pinned] : available;
}

/**
 * 版面情境：交給 yarBuildPlayerCss 的 context。
 *
 * - allowUpscale：只有「已是這支影片的最高畫質、仍填不滿螢幕」時才允許超過原生解析度放大
 * - aspectRatio：播放器容器要用的長寬比，來自 yarAspectRatioOf()。影片中繼資料還沒到手時
 *   它就回 16:9（不是 0），layout.js 再把「約等於 16:9」歸一成字面寫法。
 *   寧可先用最常見的比例，也不要在載入初期拿一個猜的數字讓版面跳動。
 *
 * @param {object} settings 已正規化的設定
 * @param {{quality:?string, viewport:object, dpr:?number, isPopupPlayer:boolean,
 *          availableQualities:Array<string>, videoWidth:number, videoHeight:number}} state
 * @returns {{allowUpscale:boolean, aspectRatio:number}}
 */
function yarLayoutContextFor(settings, state) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    allowUpscale: yarShouldUpscale(
      yarDesiredQualityForDisplay(settings, s),
      yarEffectiveAvailableQualities(settings, s.availableQualities)
    ),
    aspectRatio: yarAspectRatioOf(s.videoWidth, s.videoHeight)
  };
}

/**
 * 新回報的畫質是否應立即套用到版面。
 *
 * 升畫質立即跟進（使用者期待的就是變大）；降畫質先等 settle，期間又升回去就不縮，
 * 藉此濾掉 YouTube 的 ABR 抖動（幾乎每支影片開播都是 medium -> hd720 -> hd1080 往上爬，
 * 照單全收的話播放器會在開播前十秒連跳好幾次尺寸）。
 *
 * @param {string} nextQuality 主世界剛回報的畫質
 * @param {string|null} currentQuality 版面目前採用的畫質；null 代表尚無基準
 * @returns {boolean} true = 立即套用；false = 交給呼叫端的 settle 計時器
 */
function yarShouldAdoptImmediately(nextQuality, currentQuality) {
  if (!currentQuality) return true;
  return yarQualityWidthOf(nextQuality) >= yarQualityWidthOf(currentQuality);
}
