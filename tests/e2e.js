/**
 * e2e.js — 端到端測試：真實載入的擴充功能 + 真實 YouTube + 真實彈出視窗
 *
 * Created: 2026-08-03
 * 用法：bash tests/run-e2e.sh          （會自動啟動 Brave 並跑完）
 *      node tests/e2e.js <port>       （對已在跑的 Brave 偵錯埠執行）
 *
 * 為什麼是 Brave 不是 Chrome：
 * Chrome 137+ 已停用 --load-extension（不報錯，安靜略過），
 * --enable-unsafe-extension-debugging 也救不回來；Brave 仍完整支援。
 * 且彈出視窗會出現在 CDP 目標清單，可直接連上量測。
 *
 * 零相依：使用 Node 內建的 WebSocket 與 fetch（Node 22+）。
 */

const PORT = process.argv[2] || '9340';
const crypto = require('node:crypto');
const path = require('node:path');
/** unpacked extension ID = 絕對路徑 SHA256 前 32 hex，各自映射 0-9a-f -> a-p */
const EXT_ROOT = path.resolve(__dirname, '..');
const EXT_ID = crypto.createHash('sha256').update(EXT_ROOT).digest('hex').slice(0, 32)
  .split('').map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Sess {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || '').slice(0, 200));
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) rej(new Error('timeout ' + method)); }, 30000);
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    const s = new Sess(ws);
    await s.send('Runtime.enable');
    return s;
  }
}

const targets = () => fetch(`${BASE}/json/list`).then((r) => r.json());
const findPage = async (pred) => (await targets()).find((t) => t.type === 'page' && pred(t));

const PROBE = `(() => {
  const flexy = document.querySelector('ytd-watch-flexy');
  const v = document.querySelector('video');
  const style = document.getElementById('yt-auto-resizer-dynamic-style');
  const box = el => el ? { w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), top: Math.round(el.getBoundingClientRect().top), left: Math.round(el.getBoundingClientRect().left) } : null;
  return {
    styleLen: style ? style.textContent.length : 0,
    mode: flexy ? { theater: flexy.hasAttribute('theater'), fullBleed: flexy.hasAttribute('full-bleed-player'), twoCol: flexy.hasAttribute('is-two-columns_') } : null,
    cssVarW: flexy ? getComputedStyle(flexy).getPropertyValue('--yar-player-w').trim() : '',
    moviePlayer: box(document.getElementById('movie_player')),
    video: box(v),
    primary: box(document.querySelector('#primary')),
    secondary: box(document.querySelector('#secondary')),
    masthead: box(document.querySelector('#masthead-container')),
    videoNative: v ? v.videoWidth + 'x' + v.videoHeight : '',
    quality: (() => { const p = document.getElementById('movie_player'); return p && p.getPlaybackQuality ? p.getPlaybackQuality() : ''; })(),
    popupButton: !!document.getElementById('yt-resizer-popup-btn'),
    scripts: ['injected','pageScript'].map(n => !!document.getElementById('yt-auto-resizer-' + n + '-flag')),
    isPopupWindow: document.documentElement.hasAttribute('yar-popup'),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    outer: { w: window.outerWidth, h: window.outerHeight },
    chromeSize: { w: window.outerWidth - window.innerWidth, h: window.outerHeight - window.innerHeight },
    scrollW: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1
  };
})()`;

const results = {};
const check = (name, pass, detail) => {
  results[name] = { pass, detail };
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/** 從真實的設定面板寫入設定，順便覆蓋 popup -> storage -> content script 這條鏈路 */
const SETTINGS = (mode) => JSON.stringify({
  enabled: true,
  resizeMode: mode,
  preferredQuality: 'auto',
  removeSideGaps: true,
  resizeMainWindow: false
});

(async () => {
  // ---------- 1. 一般兩欄模式 ----------
  let page = await findPage((t) => t.url.includes('youtube.com/watch'));
  const main = await Sess.open(page.webSocketDebuggerUrl);
  for (let i = 0; i < 40; i++) {
    if (await main.eval(`!!document.querySelector('video') && document.querySelector('video').videoWidth > 0`)) break;
    await sleep(1000);
  }
  await sleep(4000);

  // ---------- 1a. 設定面板 -> content script（含「有沒有真的變大」的對照） ----------
  await main.send('Target.createTarget', { url: `chrome-extension://${EXT_ID}/popup.html` });
  await sleep(2500);
  const panelTarget = await findPage((t) => t.url.includes('popup.html'));
  check('設定面板可開啟', !!panelTarget, panelTarget ? '' : `找不到 chrome-extension://${EXT_ID}/popup.html`);

  if (panelTarget) {
    const panel = await Sess.open(panelTarget.webSocketDebuggerUrl);
    const applyMode = async (mode) => {
      await panel.eval(`new Promise(r => chrome.storage.sync.set({ yt_auto_resizer_settings: ${SETTINGS(mode)} }, r))`);
      await sleep(3000);
      return main.eval(PROBE);
    };

    const native = await applyMode('default');
    const auto = await applyMode('autoByQuality');
    check('設定面板改模式會即時反映到頁面', native.styleLen === 0 && auto.styleLen > 0,
      `default styleLen=${native.styleLen} auto styleLen=${auto.styleLen}`);

    /*
     * 這是整個擴充功能存在的理由：自動模式必須明顯大於 YouTube 原生尺寸。
     * 曾經因為寬度公式預扣 400px 側欄，1600px 視窗上原生 1112px、自動 1128px，
     * 只差 16px —— 使用者的回報就是「還是不能自動」。
     */
    const gain = auto.moviePlayer.w / native.moviePlayer.w;
    check('自動模式必須明顯放大播放器', gain >= 1.15,
      `原生 ${native.moviePlayer.w}x${native.moviePlayer.h} -> 自動 ${auto.moviePlayer.w}x${auto.moviePlayer.h} (${(gain * 100 - 100).toFixed(1)}%)`);

    const wasted = auto.viewport.h - auto.moviePlayer.h;
    check('自動模式應吃滿視窗高度', wasted <= 140, `垂直剩餘 ${wasted}px / 視窗高 ${auto.viewport.h}px`);
    check('自動模式無橫向溢出', !auto.overflow, `scrollW=${auto.scrollW} viewport=${auto.viewport.w}`);
    check('側欄放不下時已換行到下方', auto.secondary.w > auto.primary.w * 0.9,
      `primary=${auto.primary.w} secondary=${auto.secondary.w}`);
  }

  let p = await main.eval(PROBE);
  check('擴充功能已注入', p.styleLen > 0 && p.scripts[0] && p.scripts[1], `styleLen=${p.styleLen} scripts=${p.scripts}`);
  check('控制列按鈕已注入', p.popupButton);
  check('一般模式無橫向溢出', !p.overflow, `scrollW=${p.scrollW} viewport=${p.viewport.w}`);
  check('影片高度未塌陷', p.video && p.video.h > 1, `video=${p.video.w}x${p.video.h}`);
  // 側欄擠不下時會換行到播放器下方，所以不能再要求「兩欄相加 <= 視窗寬」，
  // 該看的是每一欄各自都在視窗內（真正的溢出由上面的 scrollWidth 檢查把關）。
  const columnsFit = p.primary && p.secondary
    && p.primary.w <= p.viewport.w && p.secondary.w <= p.viewport.w;
  check('每一欄都在視窗內', columnsFit, `primary=${p.primary.w} secondary=${p.secondary.w} viewport=${p.viewport.w}`);
  const baseline = p;

  // ---------- 2. YouTube 原生劇院模式 ----------
  await main.eval(`document.querySelector('.ytp-size-button').click()`);
  await sleep(4500);
  let t = await main.eval(PROBE);
  check('劇院模式無橫向溢出', !t.overflow, `scrollW=${t.scrollW} viewport=${t.viewport.w}`);
  check('劇院模式不介入(變數未套用)', t.mode.fullBleed ? t.cssVarW === '' : true, `fullBleed=${t.mode.fullBleed} cssVarW="${t.cssVarW}"`);
  check('劇院模式播放器滿寬', t.moviePlayer.w >= t.viewport.w - 40, `player=${t.moviePlayer.w} viewport=${t.viewport.w}`);

  // 切回兩欄
  await main.eval(`document.querySelector('.ytp-size-button').click()`);
  await sleep(4500);
  let back = await main.eval(PROBE);
  check('切回兩欄後版面恢復', !back.overflow && back.cssVarW.includes('min('), `cssVarW=${back.cssVarW.slice(0, 40)}`);

  // ---------- 3. 彈出式播放器 ----------
  const beforeTargets = (await targets()).length;
  await main.eval(`document.getElementById('yt-resizer-popup-btn').click()`);
  await sleep(6000);

  // YouTube 會清掉 URL hash，改用「不是原本那個分頁」來辨識彈出視窗
  const watchPages = (await targets()).filter((t) => t.type === 'page' && t.url.includes('/watch'));
  const popupTarget = watchPages.find((t) => t.id !== page.id);
  check('彈出視窗已開啟', !!popupTarget, popupTarget ? `共 ${watchPages.length} 個 watch 分頁` : '沒有新視窗');

  /*
   * Service worker 檢查必須緊接在剛剛喚醒它的動作之後。MV3 的 service worker 閒置約 30 秒
   * 就會被回收，放到最後檢查會拿到「找不到」的假失敗（實測過一次）。
   */
  const swTarget = (await targets()).find((x) => x.url === `chrome-extension://${EXT_ID}/background.js`);
  check('Service worker 已註冊', !!swTarget, swTarget ? swTarget.url : '找不到（可能已閒置回收）');
  if (swTarget) {
    const sw = await Sess.open(swTarget.webSocketDebuggerUrl);
    const swOk = await sw.eval(`typeof yarBuildPopupUrl === 'function' && typeof yarFitWindowSize === 'function'`);
    check('Service worker 載入共用設定成功', swOk);
  }

  if (popupTarget) {
    const pop = await Sess.open(popupTarget.webSocketDebuggerUrl);
    for (let i = 0; i < 30; i++) {
      if (await pop.eval(`!!document.querySelector('video') && document.querySelector('video').videoWidth > 0`)) break;
      await sleep(1000);
    }
    await sleep(11000); // 等閉環校正（400/1200/2500/4000/6000ms）收斂

    const pp = await pop.eval(PROBE);
    check('彈出視窗認得 popup 標記', pp.isPopupWindow);
    check('彈出視窗已隱藏頁首', !pp.masthead || pp.masthead.h < 1, `masthead=${pp.masthead ? pp.masthead.h : 'none'}`);
    check('彈出視窗已隱藏推薦欄', !pp.secondary || pp.secondary.w < 1, `secondary=${pp.secondary ? pp.secondary.w : 'none'}`);
    check('彈出視窗不注入彈出按鈕', !pp.popupButton);

    // 核心：內容區是否貼合影片（無黑邊）
    const vw = pp.video.w, vh = pp.video.h;
    const gapX = pp.viewport.w - vw, gapY = pp.viewport.h - vh;
    check('彈出視窗影片填滿內容區(無黑邊)', Math.abs(gapX) <= 4 && Math.abs(gapY) <= 4,
      `viewport=${pp.viewport.w}x${pp.viewport.h} video=${vw}x${vh} 空隙=${gapX}x${gapY}`);

    /*
     * 全新的測試 profile 媒體互動分數為零，YouTube 會擋掉彈出視窗的自動播放，
     * 影片中繼資料因此不會載入（videoWidth 維持 0）。此時校正用的是 16:9 退路值，
     * 就拿 16:9 當基準比對，否則會拿 NaN 去比而得到假失敗。
     */
    const [nw, nh] = pp.videoNative.split('x').map(Number);
    const loaded = nw > 0 && nh > 0;
    const nativeRatio = loaded ? nw / nh : 16 / 9;
    const contentRatio = pp.viewport.w / pp.viewport.h;
    check('彈出視窗內容區符合影片長寬比', Math.abs(contentRatio - nativeRatio) < 0.03,
      `content=${contentRatio.toFixed(3)} 基準=${nativeRatio.toFixed(3)} (${loaded ? pp.videoNative : '影片未自動播放，用 16:9 退路'}) chrome=${pp.chromeSize.w}x${pp.chromeSize.h}`);
    check('彈出視窗未超出螢幕', pp.outer.h <= 1200 && pp.outer.w <= 2000, `outer=${pp.outer.w}x${pp.outer.h}`);

    results.__popupDetail = pp;
    await pop.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  }

  check('頁面無未捕捉例外', main.errors.length === 0, main.errors.slice(0, 3).join(' | '));

  console.log('\n--- 彈出視窗細節 ---');
  console.log(JSON.stringify(results.__popupDetail, null, 2));
  const failed = Object.entries(results).filter(([k, v]) => k[0] !== '_' && !v.pass);
  console.log(`\n總計: ${Object.keys(results).filter(k => k[0] !== '_').length - failed.length} 通過 / ${failed.length} 失敗`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('SCRIPT FAILED:', e.message); process.exit(2); });
