/**
 * window-fit.js — 瀏覽器視窗尺寸請求與彈出視窗閉環校正的計算核心（純函式，無副作用）
 * Pure geometry for browser-window sizing and pop-out player calibration.
 *
 * Created: 2026-08-07
 * 依賴 (depends on): src/config.js（YAR_LAYOUT / YAR_QUALITY_WIDTH / yarQualityWidthOf）、
 *                    src/layout.js（yarReservePageWidth）
 * 載入端 (loaded by): content script (isolated world)
 *
 * 為什麼要從 content.js 抽出來：
 * 彈出視窗的校正邏輯踩過兩次坑（震盪、每輪持續縮小），兩次都是靠開真的視窗來回拖才發現的。
 * 那些坑全都是純幾何問題——把它抽成沒有 chrome API 的函式之後，「受限後只能調寬度」
 * 這種不變量就能寫成斷言，不必再靠真機重現。
 */

/* eslint-disable no-unused-vars */

/**
 * 彈出視窗校正的收斂容差。
 * 視窗尺寸有系統粒度，硬要逼到 1px 只會換來無效重試。
 */
const YAR_POPUP_CALIBRATION_TOLERANCE_PX = 8;

/**
 * 判定「高度被系統截短」的容差。
 * 差個一兩 px 是四捨五入，不是選單列。
 */
const YAR_HEIGHT_CAP_TOLERANCE_PX = 2;

/**
 * 實測視窗外框（標題列、分頁列、網址列…）佔掉的尺寸。
 *
 * 這個值無法事先猜：一般視窗有分頁列與網址列（實測 171px），彈出視窗只有標題列，
 * 而且隨平台與瀏覽器而異。猜錯的直接後果就是內容區不是影片的長寬比、上下或左右出現黑邊。
 *
 * 高度差為 0 一律視為「還沒量到」而非「沒有外框」：任何真實視窗都至少有標題列，
 * 量到 0 只可能是頁面尚未完成版面計算，拿去算會得到一個比螢幕還大的視窗。
 *
 * @returns {{width:number, height:number}|null} 尚未量得可信值時回傳 null
 */
function yarWindowChromeFrom(outerWidth, innerWidth, outerHeight, innerHeight) {
  const extraWidth = outerWidth - innerWidth;
  const extraHeight = outerHeight - innerHeight;
  if (!Number.isFinite(extraWidth) || !Number.isFinite(extraHeight)) return null;
  if (extraWidth < 0 || extraHeight <= 0) return null;
  return { width: extraWidth, height: extraHeight };
}

/**
 * 影片的實際長寬比；取不到時退回 16:9。
 *
 * 影片中繼資料載入前 `video.videoWidth` / `videoHeight` 都是 0（全新 profile 被擋自動播放時
 * 會維持 0 很久），直接相除會得到 0 或 NaN，之後所有尺寸計算都會壞掉。
 *
 * @returns {number} 寬 / 高
 */
function yarAspectRatioOf(videoWidth, videoHeight) {
  const w = Number.isFinite(videoWidth) && videoWidth > 0 ? videoWidth : 0;
  const h = Number.isFinite(videoHeight) && videoHeight > 0 ? videoHeight : 0;
  if (!w || !h) return 16 / 9;
  return w / h;
}

/**
 * 組出「視窗尺寸請求」交給 service worker 去算最終尺寸。
 *
 * 這裡刻意**不**碰 `window.screen.avail*`。實測（2026-08-04，Brave，同一實例同一時刻）：
 *   YouTube 頁面           screen 1680x1050、screenX 8      ← 被指紋防護竄改
 *   擴充功能 service worker  chrome.system.display 1710x1107 與 3840x2160  ← 真值
 * 也就是說頁面端量到的螢幕尺寸是假的。要替 3840x2160 的外接螢幕算視窗時，用被竄改成 1680
 * 的數字會算出一個小一半的視窗。真正知道螢幕的是 service worker，因此由它負責夾擠與定位，
 * 這裡只提供「內容需求」。
 *
 * 一般視窗的 extraWidth 只扣頁面內距與捲軸，不扣側欄：側欄不再固定佔住播放器右側
 * （放不下就換行到下方，見 layout.js 的 yarColumnsCss），與 CSS 的寬度運算式同一套假設。
 *
 * @param {object} settings 已正規化的設定
 * @param {{quality:?string, isPopup:boolean, measuredChrome:?object,
 *          videoWidth:number, videoHeight:number}} state
 *        measuredChrome 只在「要調整的視窗就是自己」時才可傳入；主視窗替尚未存在的彈出視窗
 *        算尺寸時量到的是自己的分頁列與網址列，套用在彈出視窗上會整個算錯，必須傳 null。
 * @returns {{playerWidth:number, extraWidth:number, extraHeight:number, aspectRatio:number}}
 */
function yarBuildFitRequest(settings, state) {
  const s = state && typeof state === 'object' ? state : {};
  const isPopup = s.isPopup === true;

  const playerWidth = yarQualityWidthOf(s.quality) || YAR_QUALITY_WIDTH.hd1080;
  const measured = s.measuredChrome && typeof s.measuredChrome === 'object' ? s.measuredChrome : null;

  const contentExtraWidth = isPopup ? 0 : yarReservePageWidth(settings.removeSideGaps);
  const fallbackChromeHeight = isPopup
    ? YAR_LAYOUT.POPUP_CHROME_HEIGHT
    : YAR_LAYOUT.MASTHEAD_HEIGHT + YAR_LAYOUT.WINDOW_CHROME_HEIGHT;

  return {
    playerWidth,
    extraWidth: contentExtraWidth + (measured ? measured.width : 0),
    extraHeight: measured ? measured.height : fallbackChromeHeight,
    aspectRatio: yarAspectRatioOf(s.videoWidth, s.videoHeight)
  };
}

/**
 * 系統是否截短了我們要求的視窗高度（macOS 選單列 / Dock / 瀏覽器的視窗下限）。
 *
 * 這個判斷必須是**單向**的。曾經每輪重新判斷，結果「縮寬」那一輪的高度要求剛好等於目前高度、
 * 必然達成，下一輪就誤認為限制解除又去加高，兩個狀態無限震盪，視窗還會每輪微幅長大。
 * 系統加的限制不會消失——呼叫端一旦拿到 true 就要永久記住，不可以再問一次。
 *
 * @param {number|null} requestedOuterHeight 上次送出的視窗外框高；尚未送出過請傳 null
 * @param {number} actualOuterHeight 目前實際的視窗外框高
 * @returns {boolean}
 */
function yarWindowHeightWasCapped(requestedOuterHeight, actualOuterHeight) {
  if (!Number.isFinite(requestedOuterHeight) || !Number.isFinite(actualOuterHeight)) return false;
  return actualOuterHeight < requestedOuterHeight - YAR_HEIGHT_CAP_TOLERANCE_PX;
}

/**
 * 彈出視窗閉環校正的下一步目標。
 *
 * 不用「預測」的方式算視窗尺寸：實際拿到的尺寸會被一堆量不到的因素影響（macOS 選單列、Dock、
 * 瀏覽器對視窗尺寸的下限）。實測就發生過要求 952 高卻只拿到 927 的情形，內容區因此不是影片
 * 的長寬比，播放器左右仍留黑邊。改成用「目前實際的內容區」反推修正量，多跑幾輪自然收斂。
 *
 * **`heightCapped` 為 true 時，呼叫端只能送出 `width`。** 受限後每多送一次 height，系統都會
 * 再截掉一個選單列的高度（實測 1600 -> 1557 -> 1512 -> 1468 -> 1423 一路縮小）。
 * `height` 仍然回傳，是給呼叫端記錄「這一輪要求了什麼」用的（下一輪的受限判斷需要它）。
 *
 * @param {{innerWidth:number, innerHeight:number, chromeWidth:number, chromeHeight:number,
 *          aspectRatio:number, heightCapped:boolean}} state
 * @returns {{innerWidth:number, innerHeight:number, width:number, height:number,
 *           heightCapped:boolean}|null} 已在容差內收斂或輸入無效時回傳 null
 */
function yarPopupCalibrationTarget(state) {
  const s = state && typeof state === 'object' ? state : {};
  const innerWidth = Number.isFinite(s.innerWidth) && s.innerWidth >= 1 ? s.innerWidth : 0;
  const innerHeight = Number.isFinite(s.innerHeight) && s.innerHeight >= 1 ? s.innerHeight : 0;
  if (!innerWidth || !innerHeight) return null;

  const chromeWidth = Number.isFinite(s.chromeWidth) ? s.chromeWidth : 0;
  const chromeHeight = Number.isFinite(s.chromeHeight) ? s.chromeHeight : 0;
  const aspect = Number.isFinite(s.aspectRatio) && s.aspectRatio > 0 ? s.aspectRatio : 16 / 9;
  const capped = s.heightCapped === true;

  const targetInnerWidth = capped ? Math.round(innerHeight * aspect) : innerWidth;
  const targetInnerHeight = capped ? innerHeight : Math.round(innerWidth / aspect);

  if (
    Math.abs(targetInnerWidth - innerWidth) < YAR_POPUP_CALIBRATION_TOLERANCE_PX &&
    Math.abs(targetInnerHeight - innerHeight) < YAR_POPUP_CALIBRATION_TOLERANCE_PX
  ) {
    return null;
  }

  return {
    innerWidth: targetInnerWidth,
    innerHeight: targetInnerHeight,
    width: targetInnerWidth + chromeWidth,
    height: targetInnerHeight + chromeHeight,
    heightCapped: capped
  };
}
