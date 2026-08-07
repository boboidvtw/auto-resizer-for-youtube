/**
 * goto.js — 把測試分頁導航到指定影片，並等到播放器真的有中繼資料
 * Navigates the e2e tab to the target video and waits for real playback metadata.
 *
 * Created: 2026-08-07
 * 用法：node tests/goto.js <port> <url>
 *
 * 為什麼不直接把網址交給 Brave 的命令列：
 * 實測（2026-08-07）同一支直式影片，**冷啟直接開 /watch 網址**時 YouTube 一律送出塞進
 * 16:9 的 padded 串流（1280x720）；先開 youtube.com 首頁再導航過去，則送出真正的
 * 9:16 串流（720x1280）。差別只有這一點，重試與釘畫質都改變不了。
 *
 * 後果不是測試變慢，而是「直式影片」這條路徑在冷啟的 harness 下**永遠測不到** ——
 * 量到的一直是 16:9，斷言全部通過，而真正要驗的東西一次也沒被碰到。
 * 順帶一提，先進首頁再點進影片本來就比較接近使用者真實的瀏覽路徑。
 */

const { connect, Sess, sleep } = require('./cdp.js');

const PORT = process.argv[2];
const URL_ARG = process.argv[3];

const fail = (msg) => { console.error(`goto: ${msg}`); process.exit(1); };

(async () => {
  if (!PORT || !URL_ARG) fail('用法：node tests/goto.js <port> <url>');

  const cdp = connect(PORT);
  const page = await cdp.findPage((t) => t.url.includes('youtube.com'));
  if (!page) fail('找不到 YouTube 分頁');

  const s = await Sess.open(page.webSocketDebuggerUrl);
  await s.send('Page.navigate', { url: URL_ARG });

  const videoId = (URL_ARG.match(/[?&]v=([A-Za-z0-9_-]{11})/) || [])[1] || '';
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const state = await s.eval(`(() => {
      const v = document.querySelector('#movie_player video');
      return JSON.stringify({
        href: location.href,
        dims: v ? v.videoWidth + 'x' + v.videoHeight : '0x0'
      });
    })()`).catch(() => null);
    if (!state) continue;
    const st = JSON.parse(state);
    const onTarget = !videoId || st.href.includes(`v=${videoId}`);
    if (onTarget && st.dims !== '0x0') {
      console.log(`已導航到 ${st.href}（影片 ${st.dims}）`);
      process.exit(0);
    }
  }
  fail(`導航後等不到播放中繼資料：${URL_ARG}`);
})().catch((e) => fail(e.message));
