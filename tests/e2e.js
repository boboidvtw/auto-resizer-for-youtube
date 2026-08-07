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
const { Sess, connect, sleep, EXT_ID } = require('./cdp.js');

const { targets, findPage } = connect(PORT);

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
    dpr: window.devicePixelRatio,
    screen: { w: screen.width, h: screen.height, aw: screen.availWidth, ah: screen.availHeight },
    availableQualities: (() => { const p = document.getElementById('movie_player'); try { return p && p.getAvailableQualityLevels ? p.getAvailableQualityLevels() : []; } catch (e) { return []; } })(),
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
const SETTINGS = (mode, overrides) => JSON.stringify(Object.assign({
  enabled: true,
  resizeMode: mode,
  preferredQuality: 'auto',
  removeSideGaps: true,
  resizeMainWindow: false,
  displayAwareQuality: true,
  autoQualityCeiling: 'hd2160',
  popupTargetDisplay: 'follow'
}, overrides));

/** 視窗寬度超過這個值就視為在高解析度螢幕上，改用嚴格門檻 */
const UHD_VIEWPORT_WIDTH = 3000;
/** 側欄原本的寬度；並排時被 flex-grow 拉超過這個倍數就是版面壞了 */
const SIDEBAR_WIDTH = 400;
const SIDEBAR_MAX_RATIO = 1.6;

/**
 * 兩欄是否在同一列。
 *
 * 不能用「側欄寬度接近播放器寬度」來反推換行：播放器縮到最小寬度（426px）時，
 * 一個正常的 400px 側欄就會滿足那個條件，於是「並排卻被拉寬」的情境會被誤判成「已換行」
 * 而放行。位置才是可靠的判準。
 */
const sameRow = (p) => !!p.primary && !!p.secondary
  && Math.abs(p.secondary.top - p.primary.top) < 80;

/** 設定要花時間走完：YouTube 自己換畫質幾秒，content.js 的降畫質還有 4s settle */
const SETTLE_MS = 14000;

/** 這支影片是不是直式（Shorts / 手機直拍） */
const isPortrait = (p) => {
  const [w, h] = (p.videoNative || '').split('x').map(Number);
  return w > 0 && h > 0 && h > w;
};

/**
 * 要求本次執行必須是直式影片。
 * 直式驗證最容易變成假通過：影片沒載入時 videoWidth 是 0，長寬比基準會退回 16:9，
 * 於是整段檢查變成拿 16:9 比 16:9。用環境變數明示意圖，跑錯影片就直接紅。
 */
const EXPECT_PORTRAIT = process.env.EXPECT_PORTRAIT === '1';

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

    /*
     * ---------- i18n 真的有填進去嗎 ----------
     * `_locales/` 存在、擴充功能載得起來、單元測試全綠 —— 這三件事加起來仍然
     * 不能證明面板上的字有被換掉。只要 popup.js 的注入沒跑（例如選擇器打錯、
     * DOMContentLoaded 沒觸發），畫面會安靜地停在 HTML 裡的英文 fallback，
     * 而所有既有檢查照樣通過。這裡直接讀真實 DOM 來驗。
     */
    const i18nProbe = await panel.eval(`(() => {
      const nodes = [...document.querySelectorAll('[data-i18n]')];
      const empty = nodes.filter((el) => !el.textContent.trim()).map((el) => el.dataset.i18n);
      const ceiling = document.getElementById('autoQualityCeiling-select');
      return JSON.stringify({
        total: nodes.length,
        empty,
        badge: (document.getElementById('version-badge') || {}).textContent || '',
        manifestVersion: chrome.runtime.getManifest().version,
        manifestName: chrome.runtime.getManifest().name,
        uiLang: chrome.i18n.getUILanguage(),
        htmlLang: document.documentElement.lang,
        ariaLabel: ceiling ? ceiling.getAttribute('aria-label') : '',
        sampleKey: 'sectionQuality',
        sampleDom: (document.querySelector('[data-i18n="sectionQuality"]') || {}).textContent || '',
        sampleMsg: chrome.i18n.getMessage('sectionQuality')
      });
    })()`);
    const i18n = JSON.parse(i18nProbe);

    check('面板所有 data-i18n 節點都有文字（沒有翻譯留白）',
      i18n.total > 10 && i18n.empty.length === 0,
      `共 ${i18n.total} 個節點，空的：${i18n.empty.join(', ') || '無'}`);

    check('面板文字確實來自 chrome.i18n，而非 HTML 裡的 fallback',
      i18n.sampleMsg !== '' && i18n.sampleDom === i18n.sampleMsg,
      `DOM="${i18n.sampleDom}" vs getMessage="${i18n.sampleMsg}" (UI 語系 ${i18n.uiLang})`);

    check('擴充功能名稱由 __MSG_extName__ 解析且不以 YouTube 開頭',
      !/^\s*youtube/i.test(i18n.manifestName) && !i18n.manifestName.includes('__MSG_'),
      `name="${i18n.manifestName}"`);

    check('版本徽章跟著 manifest 走，沒有硬編碼',
      i18n.badge === `v${i18n.manifestVersion}`,
      `徽章="${i18n.badge}" manifest=${i18n.manifestVersion}`);

    check('aria-label 也有在地化', !!i18n.ariaLabel, `aria-label="${i18n.ariaLabel}"`);
    check('<html lang> 跟著瀏覽器 UI 語系', i18n.htmlLang === i18n.uiLang,
      `html lang="${i18n.htmlLang}" UI="${i18n.uiLang}"`);

    /*
     * 面板的對外連結必須在白名單內。PRIVACY.md 對使用者承諾「唯一的外部連結是贊助連結」，
     * 而這種承諾最容易在日後某次「順手加個回饋表單/統計連結」時默默失效 ——
     * 靜態掃描抓得到 fetch，抓不到一個長得很無辜的 <a href>。
     */
    const links = JSON.parse(await panel.eval(`JSON.stringify(
      [...document.querySelectorAll('a[href]')]
        .map((a) => a.href)
        .filter((h) => /^https?:/.test(h))
    )`));
    const ALLOWED_HOSTS = ['www.paypal.me'];
    const unexpected = links.filter((h) => !ALLOWED_HOSTS.includes(new URL(h).host));
    check('設定面板沒有預期外的對外連結',
      unexpected.length === 0,
      `連結：${links.join(', ') || '無'}${unexpected.length ? ` / 非白名單：${unexpected.join(', ')}` : ''}`);

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
    /*
     * 側欄只有兩種可接受的樣子：擠不下就換行並撐滿整列，擠得下就以原寬度並排。
     * 早期只斷言「一定會換行」——那在 1600px 視窗上碰巧成立，但在 3840px 的螢幕上
     * 播放器 3312 + 間距 24 + 側欄 400 = 3736 仍放得下，正確行為就是並排。
     * 真正不能接受的是第三種：並排但被 flex-grow 拉成 1900px 寬。
     */
    const autoWrapped = !sameRow(auto);
    check('側欄要嘛換行撐滿、要嘛並排且未被拉寬',
      autoWrapped || auto.secondary.w <= SIDEBAR_WIDTH * SIDEBAR_MAX_RATIO,
      `primary=${auto.primary.w} secondary=${auto.secondary.w} 換行=${autoWrapped}`);

    console.log(
      `\n[螢幕] viewport ${auto.viewport.w}x${auto.viewport.h} @${auto.dpr}x`
      + ` | screen ${auto.screen.w}x${auto.screen.h} (avail ${auto.screen.aw}x${auto.screen.ah})`
      + ` | 播放器實體像素 ${Math.round(auto.moviePlayer.w * auto.dpr)}`
      + ` | 畫質 ${auto.quality} | 可用 ${(auto.availableQualities || []).join(',') || '未知'}`
      + ` | 影片原生 ${auto.videoNative || '未載入'}\n`
    );

    // ---------- 1b. 直式 / 非 16:9 影片 ----------
    /*
     * 用 EXPECT_PORTRAIT=1 搭配一支直式影片的 VIDEO= 來跑。
     *
     * 畫質必須釘死。實測 YouTube 對**同一支** Short 在不同 session 會給兩種串流：
     * 真正的 9:16（hd720 = 720x1280）或塞進 16:9 的 padded 版（1920x1080）。auto 之下
     * 量到哪一種純看運氣，於是「驗證直式影片」有一半機率其實在驗 16:9。
     * 720p 的 rendition 實測穩定是 720x1280，釘住它答案才可重現。
     */
    if (EXPECT_PORTRAIT) {
      const portraitSettings = (mode) => SETTINGS(mode, {
        displayAwareQuality: false,
        preferredQuality: '720p'
      });
      const applyPortrait = async (mode) => {
        await panel.eval(`new Promise(r => chrome.storage.sync.set({ yt_auto_resizer_settings: ${portraitSettings(mode)} }, r))`);
        await sleep(SETTLE_MS);
        return main.eval(PROBE);
      };

      /*
       * 拿到直式串流本身是機率事件，重載幾次提高命中率。
       * 實測同一支影片、同樣的設定，有時給 720x1280（真 9:16），有時給 1280x720
       * （把直式內容嵌進 16:9 的 padded 版）—— 決定權在 YouTube 端，我們控制不了。
       */
      let pNative = null;
      let pAuto = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        pNative = await applyPortrait('default');
        pAuto = await applyPortrait('autoByQuality');
        if (isPortrait(pNative) && isPortrait(pAuto)) break;
        console.log(`[直式] 第 ${attempt} 次拿到的是 ${pNative.videoNative}／${pAuto.videoNative}，重載再試`);
        if (attempt < 3) {
          await main.send('Page.reload', { ignoreCache: true });
          await sleep(12000);
        }
      }

      if (!(isPortrait(pNative) && isPortrait(pAuto))) {
        /*
         * 刻意「略過」而不是「失敗」：這條紅燈不代表產品壞了，只代表 YouTube 這次給了
         * padded 串流。把不可控的外部條件做成紅燈，換來的是一條沒人相信的檢查。
         * 但也絕不能安靜通過——真正的守門在 unit.test.js（長寬比推導與防漂移），
         * 這裡負責在跑不到的時候講清楚跑不到。
         */
        console.log(
          `\n[略過] 三次都沒拿到直式串流（default=${pNative.videoNative} auto=${pAuto.videoNative}）。`
          + '\n        YouTube 會逐 session 決定要給 9:16 還是塞進 16:9 的 padded 版，這不受我們控制。'
          + '\n        直式版面的守門在 unit.test.js（yarLayoutAspectRatio / 防漂移），本次未經真機複驗。\n'
        );
      }

      if (isPortrait(pNative) && isPortrait(pAuto)) {
        /*
         * 關鍵在於比「使用者真的看得到的影像」而不是「播放器容器」。
         * <video> 元素套了 object-fit: contain，容器被撐寬時元素框跟著寬，
         * 但裡面的影像仍是原長寬比 —— 只看容器會得到「變大了」的錯誤結論。
         * 這正是修正前的實測：容器 1280x720 看起來比原生 1038x780 寬，
         * 可見影像卻從 439x780 掉到 405x720。
         */
        const visible = (p) => {
          const [nw, nh] = p.videoNative.split('x').map(Number);
          const ratio = nw / nh;
          return {
            w: Math.min(p.video.w, Math.round(p.video.h * ratio)),
            h: Math.min(p.video.h, Math.round(p.video.w / ratio))
          };
        };
        const vn = visible(pNative);
        const va = visible(pAuto);
        const areaGain = (va.w * va.h) / (vn.w * vn.h);

        check('[直式] 可見影像不得比 YouTube 原生小',
          va.w >= vn.w && va.h >= vn.h,
          `原生 ${vn.w}x${vn.h} -> 自動 ${va.w}x${va.h}（面積 ${(areaGain * 100 - 100).toFixed(1)}%）`);

        check('[直式] 播放器容器要跟著影片長寬比，不得被壓成 16:9',
          pAuto.moviePlayer.h > pAuto.moviePlayer.w,
          `容器 ${pAuto.moviePlayer.w}x${pAuto.moviePlayer.h}`
          + `（16:9 會是寬>高；影片 ${pAuto.videoNative}）`);

        check('[直式] 無橫向溢出', !pAuto.overflow,
          `scrollW=${pAuto.scrollW} viewport=${pAuto.viewport.w}`);

        check('[直式] 沒有吃掉視窗高度以外的空間',
          pAuto.moviePlayer.h <= pAuto.viewport.h,
          `容器高 ${pAuto.moviePlayer.h} / 視窗高 ${pAuto.viewport.h}`);

        console.log(
          `\n[直式實測] 影片 ${pAuto.videoNative}`
          + ` | 原生 容器 ${pNative.moviePlayer.w}x${pNative.moviePlayer.h} 可見 ${vn.w}x${vn.h}`
          + ` | 自動 容器 ${pAuto.moviePlayer.w}x${pAuto.moviePlayer.h} 可見 ${va.w}x${va.h}`
          + ` | 面積 ${(areaGain * 100 - 100).toFixed(1)}%\n`
        );
      }
    }

    // ---------- 1c. 小播放器情境：側欄不得吃光剩餘空間 ----------
    /*
     * 釘死 240p 並關掉螢幕感知，把播放器壓到最小寬度，視窗剩下的空間全部暴露給側欄的
     * flex-grow。這正是 v2.2.0 觀察到「240p 影片下側欄被拉成 1150px」的情境。
     * 4K 那條對應的檢查在內建螢幕上跑不到（它需要 3840px 的視窗），所以要另外有一條。
     */
    const pinnedSettings = SETTINGS('autoByQuality', {
      displayAwareQuality: false,
      preferredQuality: '240p'
    });
    await panel.eval(`new Promise(r => chrome.storage.sync.set({ yt_auto_resizer_settings: ${pinnedSettings} }, r))`);
    await sleep(SETTLE_MS);
    const pinned = await main.eval(PROBE);

    // 前置：情境真的重現了嗎？播放器沒有縮小的話，下面那條什麼都沒守到
    const slack = pinned.viewport.w - pinned.primary.w;
    const pinnedReproduced = pinned.primary.w <= 700 && slack >= SIDEBAR_WIDTH * SIDEBAR_MAX_RATIO;
    check('[小播放器] 已重現「播放器縮到最小、視窗剩餘空間遠大於側欄」的情境',
      pinnedReproduced,
      `player=${pinned.primary.w} viewport=${pinned.viewport.w} 剩餘=${slack}px 畫質=${pinned.quality}`);

    check('[小播放器] 側欄並排時不得被 flex-grow 拉寬',
      pinnedReproduced && (!sameRow(pinned) || pinned.secondary.w <= SIDEBAR_WIDTH * SIDEBAR_MAX_RATIO),
      `player=${pinned.primary.w} secondary=${pinned.secondary.w}`
      + ` (上限 ${SIDEBAR_WIDTH * SIDEBAR_MAX_RATIO}, 同列=${sameRow(pinned)}, 情境重現=${pinnedReproduced})`);

    check('[小播放器] 無橫向溢出', !pinned.overflow,
      `scrollW=${pinned.scrollW} viewport=${pinned.viewport.w}`);

    await panel.eval(`new Promise(r => chrome.storage.sync.set({ yt_auto_resizer_settings: ${SETTINGS('autoByQuality')} }, r))`);
    await sleep(4000);

    // ---------- 1d. 高解析度螢幕專屬門檻 ----------
    const isUhd = auto.viewport.w >= UHD_VIEWPORT_WIDTH;
    if (isUhd) {
      /*
       * 這幾條是 v2.3.0 的存在理由。舊版在 3840px 寬的視窗上播 1080p 影片時，
       * 播放器被畫質原生寬度鎖在 1920px（只用掉視窗的一半），右側剩下的 1900px
       * 全被 flex-grow 的側欄吃光。同一份程式在 1710px 的內建螢幕上完全量不出來，
       * 因為 1920 從來不是 binding constraint —— 這就是為什麼一定要在 4K 上跑一次。
       */
      const fill = auto.moviePlayer.w / auto.viewport.w;
      check('[4K] 播放器須用掉視窗寬的 85% 以上', fill >= 0.85,
        `player=${auto.moviePlayer.w} / viewport=${auto.viewport.w} = ${(fill * 100).toFixed(1)}%`);
      check('[4K] 相對 YouTube 原生須放大 60% 以上', gain >= 1.6,
        `原生 ${native.moviePlayer.w} -> 自動 ${auto.moviePlayer.w} (+${(gain * 100 - 100).toFixed(1)}%)`);

      const wantedPhysical = auto.moviePlayer.w * auto.dpr;
      check('[4K] 已依螢幕主動要到足夠畫質', ['hd2160', 'hd1440', 'highres'].includes(auto.quality),
        `播放器實體 ${Math.round(wantedPhysical)}px，實得畫質 ${auto.quality}`);

      /*
       * 把畫質上限鎖回 1080p 並關掉螢幕感知，重現「播放器被 cap 在 1920px」的情境，
       * 直接驗證 #columns 的寬度上限有沒有攔住側欄。這是唯一能證明那條 CSS 有作用的辦法：
       * 開著螢幕感知時播放器會撐滿、側欄自然換行，反而繞過了要驗的東西。
       */
      const cappedSettings = SETTINGS('autoByQuality', {
        displayAwareQuality: false,
        preferredQuality: '1080p'
      });
      await panel.eval(`new Promise(r => chrome.storage.sync.set({ yt_auto_resizer_settings: ${cappedSettings} }, r))`);
      /*
       * 必須等夠久：YouTube 自己要花幾秒切到 1080p，content.js 又刻意讓「降畫質」
       * 等 QUALITY_SHRINK_SETTLE_MS(4s) 穩定才縮版面（濾 ABR 抖動）。
       * 只等 4 秒會量到還沒縮的狀態，斷言就會在情境根本沒重現的情況下通過。
       */
      await sleep(SETTLE_MS);
      const capped = await main.eval(PROBE);

      // 先確認情境真的重現了，否則下面那條「側欄沒被拉寬」只是在測未受限的版面
      const cappedReproduced = capped.quality === 'hd1080' && capped.primary.w <= 2000;
      check('[4K] 已重現「播放器被畫質原生寬鎖住」的情境', cappedReproduced,
        `quality=${capped.quality} player=${capped.primary.w}（預期 hd1080 / <=2000）`);

      const sidebarWrapped = !sameRow(capped);
      check('[4K] 畫質受限時側欄不被 flex-grow 拉寬',
        cappedReproduced && !sidebarWrapped && capped.secondary.w <= SIDEBAR_WIDTH * SIDEBAR_MAX_RATIO,
        `player=${capped.primary.w} secondary=${capped.secondary.w}`
        + ` (上限 ${SIDEBAR_WIDTH * SIDEBAR_MAX_RATIO}, 換行=${sidebarWrapped}, 情境重現=${cappedReproduced})`);
      check('[4K] 畫質受限時仍無橫向溢出', !capped.overflow,
        `scrollW=${capped.scrollW} viewport=${capped.viewport.w}`);

      await panel.eval(`new Promise(r => chrome.storage.sync.set({ yt_auto_resizer_settings: ${SETTINGS('autoByQuality')} }, r))`);
      await sleep(4000);
    } else {
      console.log('[略過] 目前不在高解析度螢幕上，4K 專屬門檻未執行（用 SCREEN=uhd bash tests/run-e2e.sh 跑）\n');
    }
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
  let sw = null;
  let displayInfo = null;
  if (swTarget) {
    sw = await Sess.open(swTarget.webSocketDebuggerUrl);
    const swOk = await sw.eval(`typeof yarBuildPopupUrl === 'function' && typeof yarFitWindowSize === 'function'`);
    check('Service worker 載入共用設定成功', swOk);

    // display.js 是 v2.3.0 新加的 importScripts；漏掉的話視窗定位會在執行時炸 ReferenceError
    const displayOk = await sw.eval(`typeof yarPickTargetDisplay === 'function' && typeof yarFitIntoWorkArea === 'function'`);
    check('Service worker 載入 display.js 成功', displayOk);

    displayInfo = await sw.eval(`new Promise(r => chrome.system.display.getInfo(d => r(d.map(x => ({ id: x.id, bounds: x.bounds, workArea: x.workArea, internal: x.isInternal, primary: x.isPrimary })))))`);
    check('chrome.system.display 可用且看得到所有螢幕', Array.isArray(displayInfo) && displayInfo.length > 0,
      JSON.stringify(displayInfo));
    console.log(`[真實螢幕] ${JSON.stringify(displayInfo)}\n`);
  }

  /*
   * 視窗落在哪台螢幕，一律問 service worker 而非頁面。
   * 實測 Brave 的指紋防護會竄改頁面端的 screen.* 與 screenX/Y（同一時刻：YouTube 頁面看到
   * screen 1680x1050 / screenX 8，chrome.system.display 卻是 1710x1107 與 3840x2160 @1710）。
   * 拿被竄改的數字做斷言會得到看不懂的假失敗。
   */
  const displayOf = (win) => {
    if (!displayInfo || !win || !Number.isFinite(win.left)) return null;
    const cx = win.left + win.width / 2;
    const cy = win.top + win.height / 2;
    return displayInfo.find((d) => cx >= d.bounds.left && cx < d.bounds.left + d.bounds.width
      && cy >= d.bounds.top && cy < d.bounds.top + d.bounds.height) || null;
  };
  const allWindows = sw
    ? await sw.eval(`new Promise(r => chrome.windows.getAll({}, ws => r(ws.map(w => ({ id: w.id, type: w.type, left: w.left, top: w.top, width: w.width, height: w.height })))))`)
    : [];

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
     *
     * ⚠️ 但這條退路會讓「驗證非 16:9 影片」整段變成假通過：基準是 16:9、內容區也是 16:9，
     * 斷言必然成立，而真正要驗的東西（長寬比有沒有跟著影片走）根本沒被碰到。
     * run-e2e.sh 已加 --autoplay-policy=no-user-gesture-required 讓中繼資料load得到，
     * 這裡再加一條硬性檢查把「沒載到」變成紅燈而不是靜默降級。
     */
    const [nw, nh] = pp.videoNative.split('x').map(Number);
    const loaded = nw > 0 && nh > 0;
    const nativeRatio = loaded ? nw / nh : 16 / 9;
    const contentRatio = pp.viewport.w / pp.viewport.h;

    check('彈出視窗的長寬比基準來自真實影片（不是 16:9 退路）', loaded,
      loaded ? pp.videoNative : '影片中繼資料未載入 —— 這條檢查會退化成 16:9 比 16:9 的假通過');

    check('彈出視窗內容區符合影片長寬比', Math.abs(contentRatio - nativeRatio) < 0.03,
      `content=${contentRatio.toFixed(3)} 基準=${nativeRatio.toFixed(3)} (${loaded ? pp.videoNative : '影片未自動播放，用 16:9 退路'}) chrome=${pp.chromeSize.w}x${pp.chromeSize.h}`);

    if (EXPECT_PORTRAIT) {
      // 同 watch 頁：串流是不是直式由 YouTube 決定，拿不到就明講略過而不是判紅
      if (loaded && nh > nw) {
        check('[直式] 彈出視窗內容區跟著影片變成直式（高 > 寬）',
          pp.viewport.h > pp.viewport.w,
          `影片 ${pp.videoNative} 內容區 ${pp.viewport.w}x${pp.viewport.h}`);
      } else {
        console.log(`[略過] 彈出視窗這次拿到的是 ${pp.videoNative}（非直式串流），直式斷言未執行`);
      }
    }
    /*
     * 原本寫死 2000x1200 的上限在 4K 上會誤判成失敗。改用 service worker 提供的真實螢幕
     * 工作區來判斷，順便驗證多螢幕定位：popupTargetDisplay 預設 follow，
     * 彈出視窗應該和來源視窗落在同一台螢幕上。
     */
    if (sw && displayInfo) {
      const after = await sw.eval(`new Promise(r => chrome.windows.getAll({}, ws => r(ws.map(w => ({ id: w.id, type: w.type, left: w.left, top: w.top, width: w.width, height: w.height })))))`);
      const popupWin = after.find((w) => w.type === 'popup');
      const sourceWin = allWindows.find((w) => w.type === 'normal') || allWindows[0];
      const popupDisplay = displayOf(popupWin);
      const sourceDisplay = displayOf(sourceWin);

      check('彈出視窗未超出所在螢幕的工作區',
        !!popupDisplay
        && popupWin.width <= popupDisplay.workArea.width + 4
        && popupWin.height <= popupDisplay.workArea.height + 4,
        popupWin
          ? `視窗 ${popupWin.width}x${popupWin.height}@${popupWin.left},${popupWin.top} 工作區 ${popupDisplay ? popupDisplay.workArea.width + 'x' + popupDisplay.workArea.height : '未落在任何螢幕'}`
          : '找不到彈出視窗');

      check('彈出視窗開在來源視窗所在的螢幕 (follow)',
        !!popupDisplay && !!sourceDisplay && popupDisplay.id === sourceDisplay.id,
        `彈出=${popupDisplay ? popupDisplay.id : '?'} 來源=${sourceDisplay ? sourceDisplay.id : '?'}`);
    }

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
