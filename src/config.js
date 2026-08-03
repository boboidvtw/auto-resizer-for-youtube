/**
 * config.js — 共用設定結構、版面常數與 storage 存取封裝
 * Shared settings schema, layout constants and storage helpers.
 *
 * Created: 2026-08-02
 * 載入端 (loaded by): content script (isolated world) / popup / service worker (importScripts)
 * 唯一的設定真相來源：chrome.storage.sync 的 YAR_STORAGE_KEY。
 */

/* eslint-disable no-unused-vars */

const YAR_STORAGE_KEY = 'yt_auto_resizer_settings';

/** v2.0 舊版 popup 誤寫到 storage.local 的扁平鍵，僅用於一次性遷移 */
const YAR_LEGACY_LOCAL_KEYS = ['enabled', 'quality', 'resizeMode', 'removeSideGaps'];

/** 設為 true 才會輸出 console 診斷訊息 */
const YAR_DEBUG = false;

/** 版面常數 — 全部集中在此，程式碼中不得出現裸數字 */
const YAR_LAYOUT = {
  MASTHEAD_HEIGHT: 56,     // YouTube 頂部固定 masthead 高度
  VERTICAL_MARGIN: 24,     // 播放器上下預留呼吸空間
  SIDEBAR_WIDTH: 400,      // #secondary 推薦影片欄寬度
  COLUMN_GAP: 24,          // 主欄與側欄間距
  PAGE_PADDING: 32,        // #columns 左右 padding 合計
  SCROLLBAR_RESERVE: 16,   // 100vw 含捲軸，需扣除避免橫向溢出
  MIN_PLAYER_WIDTH: 426,   // 播放器寬度下限
  WINDOW_CHROME_HEIGHT: 120, // 一般視窗：標題列 + 網址列 + YouTube 資訊區估值
  POPUP_CHROME_HEIGHT: 28    // 彈出視窗：只有標題列
};

/** 畫質抖動（ABR 自動切換）時避免視窗連續跳動的冷卻時間 */
const YAR_WINDOW_RESIZE_COOLDOWN_MS = 1500;

/**
 * 依畫質算出視窗尺寸，讓「內容區」剛好等於影片長寬比。
 *
 * 兩個容易做錯的地方：
 * 1. 只夾寬度不夾高度 —— 1920 寬會算出 1080 高，超過多數筆電的可用高度。
 * 2. 把視窗外框一起等比縮放 —— 外框（標題列、網址列）是固定像素，不會隨視窗變小而變小。
 *    連同外框一起縮，內容區就不再是影片的長寬比，播放器上下或左右會出現黑邊。
 *    正確做法是先扣掉外框，只對內容區做夾擠。
 *
 * @param {number} playerWidth 畫質對應的播放器原生寬度
 * @param {number} extraWidth  視窗比內容區多出的寬度（側欄 + 視窗邊框）
 * @param {number} extraHeight 視窗比內容區多出的高度（標題列 / 網址列等）
 * @param {number} availWidth  螢幕可用寬
 * @param {number} availHeight 螢幕可用高
 * @param {number} [aspectRatio=16/9] 影片長寬比
 * @returns {{width: number, height: number}}
 */
function yarFitWindowSize(playerWidth, extraWidth, extraHeight, availWidth, availHeight, aspectRatio) {
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 16 / 9;

  const roomWidth = Math.max(YAR_LAYOUT.MIN_PLAYER_WIDTH, availWidth - extraWidth);
  const roomHeight = Math.max(1, availHeight - extraHeight);

  const contentWidth = Math.min(playerWidth, roomWidth, roomHeight * ratio);
  const contentHeight = contentWidth / ratio;

  return {
    width: Math.round(contentWidth + extraWidth),
    height: Math.round(contentHeight + extraHeight)
  };
}

/** 畫質代碼 → 原生像素寬度（高度一律由 16:9 推導） */
const YAR_QUALITY_WIDTH = {
  highres: 7680,
  hd2160: 3840,
  hd1440: 2560,
  hd1080: 1920,
  hd720: 1280,
  large: 854,
  medium: 640,
  small: 426,
  tiny: 256
};

/** popup 下拉選單值 → YouTube 內部畫質代碼 */
const YAR_QUALITY_ALIAS = {
  '2160p': 'hd2160',
  '1440p': 'hd1440',
  '1080p': 'hd1080',
  '720p': 'hd720',
  '480p': 'large',
  '360p': 'medium',
  '240p': 'small',
  '144p': 'tiny',
  auto: 'auto'
};

const YAR_RESIZE_MODES = ['autoByQuality', 'fitWindow', 'theater', 'default'];

const YAR_DEFAULT_SETTINGS = {
  enabled: true,
  resizeMode: 'autoByQuality',
  preferredQuality: 'auto',   // 'auto' = 不干預 YouTube 自動畫質
  removeSideGaps: true,
  resizeMainWindow: false     // 主動改動使用者瀏覽器視窗，預設關閉
};

/** 訊息 action 常數，避免字串散落 */
const YAR_MSG = {
  GET_SETTINGS: 'GET_SETTINGS',
  RESIZE_WINDOW: 'RESIZE_WINDOW',
  OPEN_POPUP_PLAYER: 'OPEN_POPUP_PLAYER',
  /** 問 service worker：這個分頁是不是它開出來的彈出式播放器 */
  IS_POPUP_PLAYER: 'IS_POPUP_PLAYER'
};

/** service worker 記住自己開過哪些彈出播放器分頁（放 storage.session，撐過 SW 回收） */
const YAR_POPUP_TABS_KEY = 'yar_popup_player_tabs';

/** 主世界 <-> 隔離世界 的事件 / postMessage 型別 */
const YAR_CHANNEL = {
  QUALITY_CHANGED: 'YT_AUTO_RESIZER_QUALITY_CHANGED',
  /** 隔離世界要求主世界重播一次目前狀態（避免錯過唯一一次廣播） */
  REQUEST_STATE: 'YT_AUTO_RESIZER_REQUEST_STATE',
  ACTION: 'YT_AUTO_RESIZER_ACTION',
  SET_QUALITY: 'SET_QUALITY'
};

const YAR_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * 彈出式播放器視窗的識別標記（放在 URL hash）。
 * 不用 youtube.com/embed/：那個路徑是設計給 iframe 的，直接當頂層視窗開會回「錯誤 153
 * 影片播放器設定錯誤」，且與影片本身是否允許嵌入無關。改為開一般 watch 頁再由
 * content script 收成純播放器，不依賴 YouTube 的嵌入政策。
 */
const YAR_POPUP_MARKER = 'yar-popup';
const YAR_POPUP_ATTRIBUTE = 'yar-popup';

function yarLog(...args) {
  if (YAR_DEBUG) console.log('[YouTube Auto Resizer]', ...args);
}

function yarWarn(...args) {
  console.warn('[YouTube Auto Resizer]', ...args);
}

/**
 * 邊界驗證：任何來自 storage / 訊息的設定都必須先過這一關。
 * 回傳全新物件，不修改輸入。
 */
function yarNormalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : YAR_DEFAULT_SETTINGS.enabled,
    resizeMode: YAR_RESIZE_MODES.includes(source.resizeMode)
      ? source.resizeMode
      : YAR_DEFAULT_SETTINGS.resizeMode,
    preferredQuality: Object.prototype.hasOwnProperty.call(YAR_QUALITY_ALIAS, source.preferredQuality)
      ? source.preferredQuality
      : YAR_DEFAULT_SETTINGS.preferredQuality,
    removeSideGaps: typeof source.removeSideGaps === 'boolean'
      ? source.removeSideGaps
      : YAR_DEFAULT_SETTINGS.removeSideGaps,
    resizeMainWindow: typeof source.resizeMainWindow === 'boolean'
      ? source.resizeMainWindow
      : YAR_DEFAULT_SETTINGS.resizeMainWindow
  };
}

/** 讀取設定；storage 不可用或出錯時回傳預設值，絕不 reject */
function yarLoadSettings() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      resolve(yarNormalizeSettings(null));
      return;
    }
    chrome.storage.sync.get([YAR_STORAGE_KEY], (result) => {
      if (chrome.runtime && chrome.runtime.lastError) {
        yarWarn('讀取設定失敗，改用預設值:', chrome.runtime.lastError.message);
        resolve(yarNormalizeSettings(null));
        return;
      }
      resolve(yarNormalizeSettings(result && result[YAR_STORAGE_KEY]));
    });
  });
}

/** 寫入設定（整份覆寫，寫入前一律正規化） */
function yarSaveSettings(settings) {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
      reject(new Error('chrome.storage.sync 不可用'));
      return;
    }
    const payload = {};
    payload[YAR_STORAGE_KEY] = yarNormalizeSettings(settings);
    chrome.storage.sync.set(payload, () => {
      if (chrome.runtime && chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(payload[YAR_STORAGE_KEY]);
    });
  });
}
