/**
 * pick-screen.js — 依真實螢幕排列把測試視窗移到指定螢幕
 * Positions the e2e browser window on a requested display, measured at runtime.
 *
 * Created: 2026-08-06
 * 用法：node tests/pick-screen.js <port> <builtin|uhd|largest|primary>
 *
 * 為什麼需要這支腳本：
 * run-e2e.sh 原本把 4K 螢幕的位置寫死成 `1710,40`，那是 2026-08-04 當下量到的排列。
 * 螢幕左右對調、換解析度、或少接一台，視窗就會開在錯的地方 —— 而且**不會有任何錯誤**：
 * 測試照樣跑完，只是量到的是另一台螢幕的數字，於是 4K 專屬門檻要嘛被靜默略過、
 * 要嘛拿內建螢幕的結果去比 4K 的標準。本 session 之前就遇過內建螢幕縮放被改動，
 * 這不是假設性風險。
 *
 * 座標一律問 service worker 的 `chrome.system.display`：
 * Brave 的指紋防護會竄改頁面端的 `screen.*` 與 `screenX/Y`（實測同一時刻頁面看到
 * 1680x1050、API 看到 1710x1107 與 3840x2160），拿頁面端的數字定位會算錯。
 *
 * 找不到指定的螢幕時**大聲失敗**（exit 1）。安靜退回別台螢幕正是這支腳本要消滅的行為。
 */

const { connect } = require('./cdp.js');

const PORT = process.argv[2] || '9350';
const TARGET = process.argv[3] || 'builtin';

/** 視窗與工作區邊緣的間隙，避免貼死邊界被系統推回來 */
const WINDOW_MARGIN_PX = 20;
/** 判定「這是一台 4K 螢幕」的邏輯寬度下限，與 src/display.js 的 YAR_UHD_MIN_WIDTH 一致 */
const UHD_MIN_LOGICAL_WIDTH = 3840;

const area = (d) => d.bounds.width * d.bounds.height;

/**
 * 依代號挑螢幕。
 * @returns {{display: object|null, reason: string}} display 為 null 代表找不到，reason 說明原因
 */
function pickDisplay(displays, target) {
  const sorted = displays.slice().sort((a, b) => area(b) - area(a));

  if (target === 'builtin') {
    const hit = displays.find((d) => d.isInternal);
    return {
      display: hit || null,
      reason: hit ? '' : '找不到內建螢幕（isInternal）'
    };
  }

  if (target === 'primary') {
    const hit = displays.find((d) => d.isPrimary) || displays[0];
    return { display: hit || null, reason: hit ? '' : '沒有任何螢幕' };
  }

  if (target === 'largest') {
    return { display: sorted[0] || null, reason: sorted[0] ? '' : '沒有任何螢幕' };
  }

  if (target === 'uhd') {
    /*
     * 只挑「最大的那台」是不夠的：單螢幕環境下最大的那台就是內建螢幕，
     * 於是 4K 專屬門檻會拿 1710px 的視窗去跑，全部靜默失準。必須驗到真的是 4K。
     */
    const hit = sorted.find((d) => d.bounds.width >= UHD_MIN_LOGICAL_WIDTH);
    return {
      display: hit || null,
      reason: hit
        ? ''
        : `沒有邏輯寬度 >= ${UHD_MIN_LOGICAL_WIDTH}px 的螢幕`
          + `（目前最寬的是 ${sorted[0] ? sorted[0].bounds.width : 0}px）`
    };
  }

  return { display: null, reason: `不認得的螢幕代號「${target}」` };
}

/** 視窗填滿目標螢幕的工作區（留邊界間隙） */
function boundsFor(display) {
  const wa = display.workArea;
  return {
    left: Math.round(wa.left + WINDOW_MARGIN_PX),
    top: Math.round(wa.top + WINDOW_MARGIN_PX),
    width: Math.round(wa.width - WINDOW_MARGIN_PX * 2),
    height: Math.round(wa.height - WINDOW_MARGIN_PX * 2)
  };
}

const describe = (d) => `${d.isInternal ? '內建' : '外接'} ${d.bounds.width}x${d.bounds.height}`
  + ` @${d.bounds.left},${d.bounds.top}`
  + ` 工作區 ${d.workArea.width}x${d.workArea.height}@${d.workArea.left},${d.workArea.top}`
  + (d.isPrimary ? ' [主]' : '');

const fail = (msg) => { console.error(`pick-screen: ${msg}`); process.exit(1); };

(async () => {
  const cdp = connect(PORT);
  const sw = await cdp.serviceWorker();
  if (!sw) fail('連不上擴充功能的 service worker，無法取得真實螢幕排列');

  const displays = await sw.eval(
    'new Promise(r => chrome.system.display.getInfo(d => r(d.map(x => ({'
    + ' id: x.id, bounds: x.bounds, workArea: x.workArea,'
    + ' isInternal: x.isInternal, isPrimary: x.isPrimary })))))'
  );
  if (!Array.isArray(displays) || displays.length === 0) fail('chrome.system.display 回傳空清單');

  console.log('偵測到的螢幕：');
  displays.forEach((d) => console.log(`  - ${describe(d)}`));

  const { display, reason } = pickDisplay(displays, TARGET);
  if (!display) fail(`要求的螢幕「${TARGET}」不存在 —— ${reason}。請接上該螢幕，或改用其他 SCREEN 值。`);

  const bounds = boundsFor(display);
  const win = await sw.eval(
    'new Promise(r => chrome.windows.getAll({}, ws => {'
    + ' const w = ws.find(x => x.type === "normal") || ws[0];'
    + ' r(w ? { id: w.id } : null); }))'
  );
  if (!win) fail('找不到可移動的瀏覽器視窗');

  await sw.eval(
    `new Promise(r => chrome.windows.update(${win.id}, ${JSON.stringify(bounds)}, () => r(true)))`
  );

  // 移完要回查：chrome.windows.update 不保證完全照給（系統會夾擠），
  // 而「以為移到 4K 了其實沒有」正是這支腳本要防的事，不能只送出就當成功。
  const actual = await sw.eval(
    `new Promise(r => chrome.windows.get(${win.id}, w =>`
    + ' r({ left: w.left, top: w.top, width: w.width, height: w.height })))'
  );
  const centerX = actual.left + actual.width / 2;
  const centerY = actual.top + actual.height / 2;
  const landedOn = displays.find((d) => centerX >= d.bounds.left && centerX < d.bounds.left + d.bounds.width
    && centerY >= d.bounds.top && centerY < d.bounds.top + d.bounds.height);

  console.log(`目標螢幕：${describe(display)}`);
  console.log(`視窗實際位置：${actual.width}x${actual.height} @${actual.left},${actual.top}`);

  if (!landedOn || landedOn.id !== display.id) {
    fail(`視窗沒有落在目標螢幕上（實際落在 ${landedOn ? describe(landedOn) : '螢幕外'}）`);
  }
  console.log('視窗已就位。');

  await assertWindowPlacementIsHonoured(sw, display);
  process.exit(0);
})().catch((e) => fail(e.message));

/**
 * harness 完整性自檢：這個瀏覽器實例願不願意照 chrome.windows.create 指定的位置開視窗。
 *
 * 為什麼需要這條：Brave 的 `--window-size` / `--window-position` 命令列旗標會覆蓋之後
 * 每一個 chrome.windows.create 的 left/top/width/height，而且**不會有任何錯誤**——
 * API 的 callback 照樣回傳一個視窗，只是座標是旗標的值。
 *
 * 這件事在 2026-08-06 之前一直讓「彈出視窗開在來源視窗所在的螢幕 (follow)」這條 e2e
 * 檢查靜默失效：主視窗被旗標開在 1710,40，彈出視窗也被同一個旗標放到 1710,40，
 * 於是「兩者在同一台螢幕」必然成立。測試是綠的，驗到的卻是命令列旗標而不是產品程式碼。
 *
 * 與其在註解裡叮嚀「不要加那兩個旗標」，不如每次跑之前實測一次。
 */
async function assertWindowPlacementIsHonoured(sw, display) {
  const probe = {
    left: Math.round(display.workArea.left + 30),
    top: Math.round(display.workArea.top + 30),
    width: 640,
    height: 480
  };
  const got = await sw.eval(
    `new Promise(r => chrome.windows.create({ url: 'about:blank', type: 'popup', focused: false,`
    + ` left: ${probe.left}, top: ${probe.top}, width: ${probe.width}, height: ${probe.height} },`
    + ' w => r({ id: w.id, left: w.left, top: w.top, width: w.width, height: w.height })))'
  );
  await sw.eval(`new Promise(r => chrome.windows.remove(${got.id}, () => r(true)))`);

  const off = Math.max(
    Math.abs(got.left - probe.left), Math.abs(got.top - probe.top),
    Math.abs(got.width - probe.width), Math.abs(got.height - probe.height)
  );
  if (off > 8) {
    fail(
      '這個瀏覽器實例沒有照 chrome.windows.create 指定的位置開視窗'
      + `（要求 ${JSON.stringify(probe)}，實得 ${JSON.stringify(got)}）。`
      + '\n  多半是啟動時帶了 --window-size / --window-position —— 它們會覆蓋 API 的座標，'
      + '\n  讓所有「視窗開在哪台螢幕」的檢查變成測試命令列旗標而不是產品程式碼。'
    );
  }
  console.log('harness 自檢：chrome.windows.create 的座標會被遵守。');
}
