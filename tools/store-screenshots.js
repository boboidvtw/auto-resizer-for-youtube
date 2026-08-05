/**
 * store-screenshots.js — 產生 Chrome Web Store 上架用的截圖素材
 * Captures 1280x800 store screenshots from a real, loaded extension.
 *
 * Created: 2026-08-05
 * 用法：bash tools/store-screenshots.sh（會自動啟動 Brave 並跑完）
 *
 * 零相依：使用 Node 內建的 WebSocket 與 fetch（Node 22+），與 tests/e2e.js 同一套做法。
 *
 * 為什麼用 Emulation.setDeviceMetricsOverride 而不是把視窗調成 1280x800：
 * 商店要的是**內容區**恰好 1280x800，而視窗外框（標題列、分頁列、網址列）的高度
 * 隨平台與瀏覽器而異，實測 macOS 上的 Brave 是 171px —— 靠調視窗永遠差那一塊。
 * 直接覆寫 device metrics 則是精確的。
 */

const fs = require('node:fs');
const path = require('node:path');

const PORT = process.argv[2] || '9351';
const OUT_DIR = path.join(__dirname, '..', 'store-assets');
const BASE = `http://127.0.0.1:${PORT}`;

/** 商店規格：1280x800 或 640x400，這裡一律產生大的那個 */
const SHOT = { width: 1280, height: 800 };

/** 跳到影片中段再截：開頭往往是黑畫面或版權卡 */
const SEEK_SECONDS = 75;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = () => fetch(`${BASE}/json/list`).then((r) => r.json());

class Sess {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (!m.id || !this.pending.has(m.id)) return;
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
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
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const s = new Sess(ws);
    await s.send('Runtime.enable');
    await s.send('Page.enable');
    return s;
  }

  close() { this.ws.close(); }
}

async function capture(session, filename) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: SHOT.width, height: SHOT.height, deviceScaleFactor: 1, mobile: false
  });
  await sleep(2000);   // 讓版面依新視埠重排並安定
  const shot = await session.send('Page.captureScreenshot', { format: 'png' });
  if (!shot || !shot.data) throw new Error(`截圖失敗：${filename}`);
  fs.writeFileSync(path.join(OUT_DIR, filename), Buffer.from(shot.data, 'base64'));
  console.log(`已產生 store-assets/${filename} (${SHOT.width}x${SHOT.height})`);
  await session.send('Emulation.clearDeviceMetricsOverride');
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const list = await targets();
  const watch = list.find((t) => t.type === 'page' && t.url.includes('youtube.com/watch'));
  if (!watch) throw new Error('找不到 YouTube 觀看頁分頁');

  const page = await Sess.open(watch.webSocketDebuggerUrl);

  // 等影片真的有畫面：videoWidth 為 0 時截到的是黑框
  for (let i = 0; i < 40; i++) {
    if (await page.eval("!!document.querySelector('video') && document.querySelector('video').videoWidth > 0")) break;
    await sleep(1000);
  }
  await sleep(5000);   // 讓版面與畫質都安定下來

  /*
   * 跳到影片中段並確保正在播放。停在 0:00 的畫面是全黑加一顆大播放鍵，
   * 那種截圖看起來像功能壞掉。跳轉後再把滑鼠移開，讓控制列自己淡出。
   */
  await page.eval(`(async () => {
    const v = document.querySelector('video');
    if (!v) return;
    v.muted = true;
    v.currentTime = ${SEEK_SECONDS};
    try { await v.play(); } catch (err) { /* 自動播放被擋時仍會有畫格，繼續 */ }
  })()`);
  await sleep(4000);

  // 把游標移到畫面外，YouTube 的控制列與標題列才會淡出
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
  await sleep(4000);

  const playback = JSON.parse(await page.eval(`(() => {
    const v = document.querySelector('video');
    return JSON.stringify({ time: Math.round(v.currentTime), paused: v.paused, w: v.videoWidth, h: v.videoHeight });
  })()`));
  console.log(`播放狀態：${playback.time}s、${playback.paused ? '暫停' : '播放中'}、原生 ${playback.w}x${playback.h}`);
  if (playback.time < 1) {
    console.warn('警告：影片仍停在起點，截圖可能是全黑畫面');
  }

  /*
   * 截圖前先確認擴充功能真的有作用。少了這一關，一旦樣式沒套上，
   * 產出的就是一組「YouTube 原生版面」的商店截圖 —— 看起來很正常，
   * 但宣傳的是我們沒做到的事。同一課題見 memory 的「會跑不等於有作用」。
   */
  const probe = JSON.parse(await page.eval(`JSON.stringify({
    styled: !!document.getElementById('yt-auto-resizer-dynamic-style'),
    styleLen: (document.getElementById('yt-auto-resizer-dynamic-style') || {}).textContent?.length || 0,
    player: (() => {
      const p = document.getElementById('movie_player');
      const r = p && p.getBoundingClientRect();
      return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
    })(),
    popupButton: !!document.getElementById('yt-resizer-popup-btn')
  })`));

  console.log(`頁面狀態：樣式 ${probe.styleLen} 字元、播放器 ${probe.player?.w}x${probe.player?.h}、彈出按鈕 ${probe.popupButton ? '在' : '不在'}`);
  if (!probe.styled || probe.styleLen === 0) {
    throw new Error('擴充功能的樣式沒有套用，截出來的會是原生版面 —— 中止');
  }

  await capture(page, '01-watch-page.png');
  page.close();

  // 設定面板：另開一個分頁截
  const crypto = require('node:crypto');
  const extRoot = path.resolve(__dirname, '..');
  const extId = crypto.createHash('sha256').update(extRoot).digest('hex').slice(0, 32)
    .split('').map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

  const browserTarget = list.find((t) => t.type === 'page');
  const browser = await Sess.open(browserTarget.webSocketDebuggerUrl);
  await browser.send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
  browser.close();
  await sleep(3000);

  const panelTarget = (await targets()).find((t) => t.url.includes('popup.html'));
  if (panelTarget) {
    const panel = await Sess.open(panelTarget.webSocketDebuggerUrl);
    const localised = await panel.eval(
      "(document.querySelector('[data-i18n=\"sectionQuality\"]') || {}).textContent || ''"
    );
    console.log(`設定面板在地化文字：「${localised}」`);

    /*
     * 面板在分頁裡會靠左貼齊，右邊留下一大片黑 —— 當商店素材很難看。
     * 只為截圖把它置中，不動 popup.css：這是素材呈現，不是產品行為。
     *
     * 關鍵是要覆寫 `body { width: 320px }`。第一次只加了 flex 置中，
     * 結果是「在 320px 寬的 body 裡置中」，畫面上完全看不出差別。
     */
    await panel.eval(`(() => {
      const s = document.createElement('style');
      s.textContent = [
        'body{width:100vw!important;min-height:100vh;margin:0;display:flex;',
        'align-items:center;justify-content:center;',
        'background:radial-gradient(circle at 50% 35%,#20242e 0%,#0a0b0e 72%)!important;}',
        '.card{width:320px;background:#0f0f12;border-radius:16px;',
        'box-shadow:0 28px 70px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.06);}'
      ].join('');
      document.head.appendChild(s);
    })()`);
    await sleep(600);

    /*
     * 面板比 800px 高，直接截會把底部的狀態列與贊助連結切掉 —— 截圖看起來像沒做完。
     * 依實際高度等比縮到放得下為止；縮放不改變任何佈局，只是把整張卡片縮小。
     */
    const fitted = JSON.parse(await panel.eval(`(() => {
      const card = document.querySelector('.card');
      const h = card.getBoundingClientRect().height;
      const scale = Math.min(1, (${SHOT.height} - 48) / h);
      card.style.transform = 'scale(' + scale + ')';
      card.style.transformOrigin = 'center center';
      return JSON.stringify({ cardHeight: Math.round(h), scale: Number(scale.toFixed(3)) });
    })()`));
    console.log(`面板高度 ${fitted.cardHeight}px，縮放 ${fitted.scale}`);
    await sleep(400);

    const centred = JSON.parse(await panel.eval(`(() => {
      const r = document.querySelector('.card').getBoundingClientRect();
      return JSON.stringify({
        left: Math.round(r.left), top: Math.round(r.top),
        width: Math.round(r.width), height: Math.round(r.height),
        bodyW: Math.round(document.body.getBoundingClientRect().width)
      });
    })()`));
    console.log(`面板位置：left=${centred.left} top=${centred.top} ${centred.width}x${centred.height} (body ${centred.bodyW})`);
    if (centred.left < 50) console.warn('警告：面板仍靠左，置中沒有生效');

    await capture(panel, '02-settings-panel.png');
    panel.close();
  } else {
    console.warn('找不到設定面板分頁，略過面板截圖');
  }

  console.log('\n完成。素材在 store-assets/');
})().catch((err) => {
  console.error('錯誤：', err.message);
  process.exit(1);
});
