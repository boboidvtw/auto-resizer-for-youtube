/**
 * cdp.js — 測試腳本共用的 Chrome DevTools Protocol 連線工具
 * Shared CDP session helper for the e2e scripts.
 *
 * Created: 2026-08-06
 * 零相依：只用 Node 內建的 WebSocket 與 fetch。
 *
 * 由 tests/e2e.js 與 tests/pick-screen.js 共用。抽出來的理由很實際：兩支腳本都必須用
 * 同一套規則算出未封裝擴充功能的 ID，各留一份遲早會漂移，而漂移的症狀是「連到別的
 * 擴充功能卻渾然不覺」——那正是這個專案已經踩過一次的坑。
 */

const crypto = require('node:crypto');
const path = require('node:path');

/** 擴充功能根目錄（本檔位於 tests/ 底下） */
const EXT_ROOT = path.resolve(__dirname, '..');

/**
 * 未封裝擴充功能的 ID = 絕對路徑 SHA256 的前 32 個 hex，逐字元映射 0-9a-f -> a-p。
 *
 * 為什麼一定要自己算：CDP 的目標清單裡會有瀏覽器自帶的元件擴充功能，
 * 看到 `chrome-extension://.../service_worker.js` 就當成自己的會連錯對象。
 * 另外路徑一改（例如 repo 改名）ID 就跟著變，寫死是行不通的。
 */
const EXT_ID = crypto.createHash('sha256').update(EXT_ROOT).digest('hex').slice(0, 32)
  .split('').map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

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
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    const s = new Sess(ws);
    await s.send('Runtime.enable');
    return s;
  }
}

/** 綁定到某個偵錯埠的一組查詢函式 */
function connect(port) {
  const base = `http://127.0.0.1:${port}`;
  const targets = () => fetch(`${base}/json/list`).then((r) => r.json());
  return {
    base,
    targets,
    findPage: async (pred) => (await targets()).find((t) => t.type === 'page' && pred(t)),
    /**
     * 取得本擴充功能 service worker 的 CDP session。
     *
     * MV3 的 service worker 閒置約 30 秒就會被回收，所以「找不到」不代表沒註冊。
     * 開一次 popup.html 就能把它叫醒（popup 一載入就會向它要設定）。
     *
     * @returns {Promise<Sess|null>} 重試後仍找不到時回傳 null
     */
    async serviceWorker(attempts = 3) {
      const url = `chrome-extension://${EXT_ID}/background.js`;
      for (let i = 0; i < attempts; i++) {
        const hit = (await targets()).find((t) => t.url === url);
        if (hit) return Sess.open(hit.webSocketDebuggerUrl);
        // 叫醒它：開一個 popup 分頁再關掉
        const created = await fetch(`${base}/json/new?chrome-extension://${EXT_ID}/popup.html`, { method: 'PUT' })
          .then((r) => r.json())
          .catch(() => null);
        await sleep(2000);
        if (created && created.id) {
          await fetch(`${base}/json/close/${created.id}`).catch(() => {});
        }
      }
      return null;
    }
  };
}

module.exports = { Sess, connect, sleep, EXT_ID, EXT_ROOT };
