/**
 * display.js — 顯示器分級、螢幕選擇與「這台螢幕需要什麼畫質」（純函式，無副作用）
 * Pure helpers for multi-display awareness and display-driven quality selection.
 *
 * Created: 2026-08-04
 * 依賴 (depends on): src/config.js 的 YAR_QUALITY_WIDTH / YAR_POPUP_TARGETS / YAR_DEFAULT_SETTINGS
 * 載入端 (loaded by): content script / popup / service worker (importScripts)
 *
 * 為什麼 dpr 是選填而不是從 API 讀：
 * macOS 上 `chrome.system.display.getInfo()` 的 `dpiX` / `dpiY` 實測**恆為 0**，`name` 恆為空字串
 * （2026-08-04 於 Brave 實測，內建 Retina + Philips 4K 雙螢幕）。因此 API 只能提供「邏輯座標」，
 * 唯一拿得到 DPR 的地方是 content script 的 `window.devicePixelRatio`，而且只涵蓋視窗所在那一台。
 * 本檔所有函式都必須在 dpr 未知時仍能給出保守而正確的答案。
 */

/* eslint-disable no-unused-vars */

/** 顯示器分級。判準是「實際算繪的像素」，不是實體面板尺寸 */
const YAR_DISPLAY_TIER = {
  STANDARD: 'standard',
  HIDPI: 'hidpi',
  UHD: 'uhd'
};

const YAR_UHD_MIN_WIDTH = 3840;
const YAR_HIDPI_MIN_WIDTH = 2560;

/** 畫質代碼由窄到寬排序，用於「挑最小的夠用畫質」 */
function yarQualityCodesAscending() {
  return Object.keys(YAR_QUALITY_WIDTH).sort((a, b) => YAR_QUALITY_WIDTH[a] - YAR_QUALITY_WIDTH[b]);
}

/** 只接受正有限數，其餘一律視為「未知」而非 0 */
function yarPositiveOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * devicePixelRatio 的合理上界。實務上最高約 3~4（Retina / 高階手機），
 * 而縮小頁面時可以低於 1，所以只設上界不設下界。
 *
 * 需要夾擠是因為這個值有一條來自訊息的路徑（popup 送給 service worker 的 `dpr`）。
 * 不夾的話一個離譜的數字就能把任何螢幕推成 UHD 分級，連帶把畫質請求推到最高。
 */
const YAR_MAX_DPR = 4;

function yarSaneDpr(value) {
  const dpr = yarPositiveOrNull(value);
  return dpr === null ? null : Math.min(dpr, YAR_MAX_DPR);
}

/**
 * 把 chrome.system.display 的一筆 display 正規化成本專案要用的形狀。
 *
 * @param {object} display chrome.system.display 的項目（bounds 必要，workArea 選填）
 * @param {number|null} [dpr] 該螢幕的 devicePixelRatio；未知請傳 null
 * @returns {object|null} 無法判讀時回傳 null（呼叫端負責略過）
 */
function yarClassifyDisplay(display, dpr) {
  if (!display || typeof display !== 'object') return null;

  const bounds = display.bounds;
  if (!bounds || typeof bounds !== 'object') return null;

  const logicalWidth = yarPositiveOrNull(bounds.width);
  const logicalHeight = yarPositiveOrNull(bounds.height);
  if (!logicalWidth || !logicalHeight) return null;

  const ratio = yarSaneDpr(dpr);
  const physicalWidth = ratio ? Math.round(logicalWidth * ratio) : null;

  // dpr 未知時退回邏輯寬度：3840 邏輯寬本身就必定是 4K 以上，
  // 而 1710 邏輯寬在未知 dpr 下只能保守判為 standard（寧可少要畫質，不可憑空升級）。
  const effectiveWidth = physicalWidth === null ? logicalWidth : physicalWidth;
  let tier = YAR_DISPLAY_TIER.STANDARD;
  if (effectiveWidth >= YAR_UHD_MIN_WIDTH) {
    tier = YAR_DISPLAY_TIER.UHD;
  } else if (effectiveWidth >= YAR_HIDPI_MIN_WIDTH) {
    tier = YAR_DISPLAY_TIER.HIDPI;
  }

  const workArea = display.workArea && typeof display.workArea === 'object' ? display.workArea : bounds;

  return {
    id: typeof display.id === 'string' ? display.id : '',
    logicalWidth,
    logicalHeight,
    dpr: ratio,
    physicalWidth,
    tier,
    isInternal: display.isInternal === true,
    isPrimary: display.isPrimary === true,
    bounds: { left: bounds.left || 0, top: bounds.top || 0, width: logicalWidth, height: logicalHeight },
    workArea: {
      left: workArea.left || 0,
      top: workArea.top || 0,
      width: yarPositiveOrNull(workArea.width) || logicalWidth,
      height: yarPositiveOrNull(workArea.height) || logicalHeight
    }
  };
}

/**
 * 產生給使用者看的螢幕標籤。
 * 不能用 `display.name`：macOS 實測恆為空字串，全部螢幕會長得一模一樣。
 *
 * 「內建 / 外接」這兩個字要跟著瀏覽器語系走，但本檔宣稱是純函式、而且同時被
 * service worker 與單元測試載入 —— 在這裡直接呼叫 `chrome.i18n` 會讓它既不純、
 * 又在 node 的測試沙箱裡炸掉。改為由呼叫端注入，預設值用英文（`default_locale`）。
 *
 * @param {object|null} classified yarClassifyDisplay 的輸出
 * @param {{internal?:string, external?:string, unknown?:string}} [labels] 已在地化的字串
 */
function yarDescribeDisplay(classified, labels) {
  const text = labels || {};
  if (!classified) return text.unknown || 'Unknown display';
  const kind = classified.isInternal
    ? (text.internal || 'Built-in')
    : (text.external || 'External');
  const size = `${classified.logicalWidth}×${classified.logicalHeight}`;
  const retina = classified.dpr && classified.dpr > 1 ? ` @${classified.dpr}x` : '';
  return `${kind} ${size}${retina}`;
}

/** 主螢幕；沒有標記 isPrimary 時退回第一台 */
function yarPrimaryDisplay(displays) {
  if (!Array.isArray(displays) || displays.length === 0) return null;
  return displays.find((d) => d && d.isPrimary === true) || displays[0];
}

/**
 * 視窗中心點落在哪一台螢幕。
 * 用中心點而非左上角：視窗跨兩台螢幕時，中心點才符合「使用者覺得它在哪」與
 * macOS 自身的歸屬判定。座標完全在螢幕外（例如螢幕剛被拔掉）時退回主螢幕。
 *
 * @param {Array} displays chrome.system.display 的原始清單
 * @param {{left:number, top:number, width:number, height:number}} windowBounds
 * @returns {object|null} 原始 display 項目
 */
function yarDisplayForWindow(displays, windowBounds) {
  const fallback = yarPrimaryDisplay(displays);
  if (!fallback || !windowBounds || typeof windowBounds !== 'object') return fallback;

  const { left, top, width, height } = windowBounds;
  if (![left, top, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return fallback;
  }

  const centerX = left + width / 2;
  const centerY = top + height / 2;

  const hit = displays.find((d) => {
    const b = d && d.bounds;
    if (!b) return false;
    return centerX >= b.left && centerX < b.left + b.width && centerY >= b.top && centerY < b.top + b.height;
  });

  return hit || fallback;
}

/**
 * 依使用者偏好挑出「彈出播放器要開在哪台螢幕」。
 * 任何無法解讀的偏好都退回主螢幕——這個函式只在完全沒有螢幕時才回傳 null。
 *
 * @param {Array} displays chrome.system.display 的原始清單
 * @param {string} preference YAR_POPUP_TARGETS 之一
 * @param {string} currentDisplayId 目前視窗所在螢幕 id（FOLLOW 用）
 * @returns {object|null}
 */
function yarPickTargetDisplay(displays, preference, currentDisplayId) {
  const fallback = yarPrimaryDisplay(displays);
  if (!fallback) return null;

  if (preference === YAR_POPUP_TARGETS.INTERNAL) {
    return displays.find((d) => d && d.isInternal === true) || fallback;
  }

  if (preference === YAR_POPUP_TARGETS.LARGEST) {
    return displays.reduce((best, current) => {
      if (!current || !current.bounds) return best;
      const area = current.bounds.width * current.bounds.height;
      const bestArea = best.bounds ? best.bounds.width * best.bounds.height : 0;
      if (area > bestArea) return current;
      // 面積相同時偏好主螢幕，避免結果隨清單順序漂移
      if (area === bestArea && current.isPrimary === true) return current;
      return best;
    }, fallback);
  }

  if (preference === YAR_POPUP_TARGETS.FOLLOW) {
    return displays.find((d) => d && d.id === currentDisplayId) || fallback;
  }

  return fallback;
}

/**
 * 把想要的視窗尺寸放進指定螢幕的工作區：等比縮到放得下，然後置中。
 *
 * 為什麼不能沿用 content script 的 `screen.avail*`：那量到的是**來源視窗**所在的螢幕。
 * 本機實測內建是 1710×1073、外接 4K 是 3840×2130，拿內建的數字去開 4K 上的視窗
 * （或反過來）會得到一個完全不對的尺寸，而且視窗還會落在螢幕外被系統推回來。
 *
 * @param {number} width 想要的視窗寬（含外框）
 * @param {number} height 想要的視窗高（含外框）
 * @param {{left:number, top:number, width:number, height:number}} workArea 目標螢幕的工作區
 * @returns {{left:number, top:number, width:number, height:number}}
 */
function yarFitIntoWorkArea(width, height, workArea) {
  const w = yarPositiveOrNull(width);
  const h = yarPositiveOrNull(height);
  const areaW = workArea && yarPositiveOrNull(workArea.width);
  const areaH = workArea && yarPositiveOrNull(workArea.height);

  if (!w || !h) return null;
  if (!areaW || !areaH) return { left: 0, top: 0, width: Math.round(w), height: Math.round(h) };

  // 只縮不放：使用者要的尺寸放得下就照給，避免小視窗被硬撐成滿螢幕
  const scale = Math.min(1, areaW / w, areaH / h);
  const finalW = Math.round(w * scale);
  const finalH = Math.round(h * scale);

  const left = workArea.left || 0;
  const top = workArea.top || 0;
  return {
    left: Math.round(left + (areaW - finalW) / 2),
    top: Math.round(top + (areaH - finalH) / 2),
    width: finalW,
    height: finalH
  };
}

/**
 * 這個播放器尺寸需要多高的畫質。
 *
 * 關鍵在於用**實體像素**（CSS 寬 × DPR）而非 CSS 像素判斷。實測這台機器：
 * 內建 Retina 的播放器 1630 CSS px × DPR 2 = 3260 實體像素，
 * 4K TV 的播放器 3502 CSS px × DPR 1 = 3502 實體像素——
 * 兩者 CSS 寬差了一倍以上，實際需要的畫質卻幾乎相同。只看 CSS 寬會在 Retina 上長期要低了。
 *
 * @param {number} cssWidth 播放器的 CSS 寬度
 * @param {number|null} dpr devicePixelRatio；未知或無效時以 1 計
 * @param {string} ceiling 畫質上限（YAR_QUALITY_WIDTH 的鍵）；無效時退回預設上限
 * @returns {string|null} 畫質代碼；輸入無效時回傳 null 代表「不干預」
 */
function yarQualityForPlayer(cssWidth, dpr, ceiling) {
  const width = yarPositiveOrNull(cssWidth);
  if (!width) return null;

  const ratio = yarSaneDpr(dpr) || 1;
  const needed = width * ratio;

  const cap = Object.prototype.hasOwnProperty.call(YAR_QUALITY_WIDTH, ceiling)
    ? ceiling
    : YAR_DEFAULT_SETTINGS.autoQualityCeiling;
  const capWidth = YAR_QUALITY_WIDTH[cap];

  const codes = yarQualityCodesAscending();
  const enough = codes.find((code) => YAR_QUALITY_WIDTH[code] >= needed);

  // 需求超過上限時就取上限；需求低於最窄畫質時取最窄的
  if (!enough) return cap;
  return YAR_QUALITY_WIDTH[enough] > capWidth ? cap : enough;
}

/**
 * 影片本身的最高畫質是否已經追不上螢幕的需求。
 *
 * 只有在「已經拿到這支影片能給的最好畫質、卻仍不夠填滿螢幕」時才回 true，
 * 此時放大是唯一能填滿畫面的辦法（使用者已明確選擇畫質優先、不夠才放大）。
 * 可用畫質清單尚未取得時一律回 false：寧可晚一步放大，也不要在載入初期亂跳尺寸。
 *
 * @param {string|null} desiredQuality yarQualityForPlayer 的輸出
 * @param {Array<string>} availableQualities 主世界 getAvailableQualityLevels() 的回報
 * @returns {boolean}
 */
function yarShouldUpscale(desiredQuality, availableQualities) {
  if (!desiredQuality || !Object.prototype.hasOwnProperty.call(YAR_QUALITY_WIDTH, desiredQuality)) {
    return false;
  }
  if (!Array.isArray(availableQualities) || availableQualities.length === 0) return false;

  /*
   * 一律走 hasOwnProperty，不能用 `YAR_QUALITY_WIDTH[code] || 0`：
   * 這個陣列來自主世界的 YouTube player 物件（頁面可控），`__proto__` 或 `constructor`
   * 會沿著原型鏈取到函式，`||` 判定為 truthy，Math.max 就得到 NaN，之後所有比較都靜默失真。
   */
  const bestAvailable = availableQualities.reduce((max, code) => {
    const width = Object.prototype.hasOwnProperty.call(YAR_QUALITY_WIDTH, code)
      ? YAR_QUALITY_WIDTH[code]
      : 0;
    return width > max ? width : max;
  }, 0);
  if (bestAvailable <= 0) return false;

  return bestAvailable < YAR_QUALITY_WIDTH[desiredQuality];
}
