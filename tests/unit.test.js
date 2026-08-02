/**
 * unit.test.js — 設定正規化與版面 CSS 產生器的回歸測試
 * Zero-dependency tests: `node --test tests/`
 *
 * Created: 2026-08-02
 * 用 node:vm 把兩支 classic script 載進共用 sandbox，不需要打包工具或測試框架。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/** classic script 的 const 宣告不會掛到 global 物件上，需明確匯出 */
const EXPORTED = [
  'YAR_DEFAULT_SETTINGS',
  'YAR_LAYOUT',
  'YAR_QUALITY_WIDTH',
  'YAR_QUALITY_ALIAS',
  'YAR_RESIZE_MODES',
  'YAR_STORAGE_KEY',
  'YAR_WINDOW_RESIZE_COOLDOWN_MS'
];

function loadSandbox() {
  const context = vm.createContext({ console });
  ['src/config.js', 'src/layout.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
  vm.runInContext(EXPORTED.map((name) => `globalThis.${name} = ${name};`).join('\n'), context);
  return context;
}

const sandbox = loadSandbox();

/** 跨 vm realm 比較物件時需先攤平，否則 prototype 不同會誤判 */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** service worker 用的沙箱：stub 掉 importScripts 與 chrome API */
function loadWorkerSandbox() {
  const noop = () => {};
  const context = vm.createContext({
    console,
    importScripts: noop,
    chrome: {
      runtime: { onMessage: { addListener: noop }, onInstalled: { addListener: noop }, lastError: null },
      storage: { sync: { get: noop, set: noop }, local: { get: noop, remove: noop } },
      windows: { update: noop, create: noop }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/config.js'), 'utf8'), context, { filename: 'config.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  vm.runInContext('globalThis.YAR_POPUP_DEFAULT = YAR_POPUP_DEFAULT;', context);
  return context;
}

const worker = loadWorkerSandbox();

// ------------------------------------------------------------ 設定正規化

test('yarNormalizeSettings: 空值回傳完整預設值', () => {
  const expected = plain(sandbox.YAR_DEFAULT_SETTINGS);
  assert.deepStrictEqual(plain(sandbox.yarNormalizeSettings(null)), expected);
  assert.deepStrictEqual(plain(sandbox.yarNormalizeSettings(undefined)), expected);
  assert.deepStrictEqual(plain(sandbox.yarNormalizeSettings('garbage')), expected);
});

test('yarNormalizeSettings: 非法列舉值退回預設', () => {
  const result = sandbox.yarNormalizeSettings({ resizeMode: 'rm -rf', preferredQuality: '9001p' });
  assert.strictEqual(result.resizeMode, 'autoByQuality');
  assert.strictEqual(result.preferredQuality, 'auto');
});

test('yarNormalizeSettings: 合法值原樣保留且不修改輸入', () => {
  const input = Object.freeze({
    enabled: false,
    resizeMode: 'theater',
    preferredQuality: '1440p',
    removeSideGaps: false,
    resizeMainWindow: true
  });
  const result = sandbox.yarNormalizeSettings(input);
  assert.deepStrictEqual(plain(result), plain(input));
  assert.notStrictEqual(result, input, '必須回傳新物件而非同一參照');
});

test('yarNormalizeSettings: 只給部分欄位時其餘補預設', () => {
  const result = sandbox.yarNormalizeSettings({ enabled: false });
  assert.strictEqual(result.enabled, false);
  assert.strictEqual(result.removeSideGaps, true);
});

// ------------------------------------------------------------ 水平預留空間

test('預留空間：單欄只扣內距與捲軸，兩欄再扣側欄', () => {
  const base = sandbox.YAR_LAYOUT.PAGE_PADDING + sandbox.YAR_LAYOUT.SCROLLBAR_RESERVE;
  const sidebar = sandbox.YAR_LAYOUT.SIDEBAR_WIDTH;
  const gap = sandbox.YAR_LAYOUT.COLUMN_GAP;

  assert.strictEqual(sandbox.yarReserveSingleColumn(), base);
  assert.strictEqual(sandbox.yarReserveTwoColumn(true), base + sidebar + gap);
  assert.strictEqual(sandbox.yarReserveTwoColumn(false), base + sidebar + gap * 2);
});

// ------------------------------------------------------------ CSS 產生器

const settingsFor = (overrides) => sandbox.yarNormalizeSettings(Object.assign({}, overrides));

/** 剝掉註解再斷言，避免說明文字裡的選擇器名稱造成誤判 */
const cssOnly = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('yarBuildPlayerCss: 停用或 default 模式一律回傳空字串', () => {
  assert.strictEqual(sandbox.yarBuildPlayerCss(settingsFor({ enabled: false }), 'hd2160'), '');
  assert.strictEqual(sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'default' }), 'hd2160'), '');
});

test('yarBuildPlayerCss: autoByQuality 以原生解析度為上限', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'autoByQuality' }), 'hd2160');
  assert.match(css, /min\(3840px,/, '4K 應以 3840px 為候選上限');
  assert.match(css, /calc\(100vw - 472px\)/, '應扣掉側欄與內距');
  assert.match(css, /calc\(\(100vh - 80px\) \* 16 \/ 9\)/, '應同時受視窗高度限制');
});

test('yarBuildPlayerCss: 寬度上限永遠同時受視窗寬與視窗高夾擠', () => {
  ['autoByQuality', 'fitWindow', 'theater'].forEach((resizeMode) => {
    const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode }), 'hd2160');
    assert.match(css, /100vw/, `${resizeMode} 必須受視窗寬度限制`);
    assert.match(css, /100vh/, `${resizeMode} 必須受視窗高度限制`);
    assert.doesNotMatch(css, /availWidth/, '不得再依賴實體螢幕尺寸');
  });
});

test('yarBuildPlayerCss: fitWindow 不受單一畫質像素上限綁架', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'fitWindow' }), 'hd720');
  assert.doesNotMatch(css, /min\(1280px/, 'fitWindow 不應被 720p 的 1280px 限制');
});

test('yarBuildPlayerCss: 寬度有下限保護', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'autoByQuality' }), 'tiny');
  assert.match(css, new RegExp(`max\\(${sandbox.YAR_LAYOUT.MIN_PLAYER_WIDTH}px,`));
});

test('yarBuildPlayerCss: 高度一律由寬度以 16:9 推導', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080');
  assert.match(css, /--yar-player-h: calc\(var\(--yar-player-w\) \* 9 \/ 16\)/);
});

test('yarBuildPlayerCss: 側欄寬度只在 YouTube 判定為兩欄時才扣除', () => {
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080'));
  const twoColumnRule = css.match(/ytd-watch-flexy\[is-two-columns_\][^{]*\{[^}]*\}/);
  assert.ok(twoColumnRule, '應有 [is-two-columns_] 覆寫規則');
  assert.match(twoColumnRule[0], /calc\(100vw - 472px\)/);
  // 基礎規則（單欄）不得扣掉側欄，否則窄視窗下播放器會縮得比需要更小
  const baseRule = css.match(/ytd-watch-flexy:not\(\[full-bleed-player\]\),[\s\S]*?\{[\s\S]*?\}/);
  assert.ok(baseRule, '應有基礎規則');
  assert.match(baseRule[0], /calc\(100vw - 48px\)/);
});

test('yarBuildPlayerCss: 接管寬度的容器一律 border-box（避免 padding 造成橫向溢出）', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080');
  assert.match(css, /box-sizing: border-box !important/);
});

test('yarBuildPlayerCss: 劇院模式不套用兩欄側欄扣除', () => {
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'theater' }), 'hd1080'));
  assert.doesNotMatch(css, /ytd-watch-flexy\[is-two-columns_\][^{]*\{\s*--yar-player-w/);
});

test('yarBuildPlayerCss: 劇院模式改為單欄堆疊', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'theater' }), 'hd1080');
  assert.match(css, /flex-direction: column/);
  assert.doesNotMatch(css, /width: 400px/, '劇院模式不應固定側欄寬度');
});

test('yarBuildPlayerCss: 關閉零留白時不干預頁面欄位版面', () => {
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({ removeSideGaps: false }), 'hd1080'));
  assert.doesNotMatch(css, /#columns/);
  assert.match(css, /--yar-player-w/, '仍應設定播放器尺寸');
});

test('yarBuildPlayerCss: 所有版面選擇器都限縮在 watch 頁元件下', () => {
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080'));
  const globalSelectors = css
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(#|ytd-|tp-yt-|\.)/.test(line) && !line.startsWith('/*'))
    .filter((line) => !line.startsWith('ytd-watch-flexy'));
  // 僅允許這些刻意全域的修正：設定選單層級與左側抽屜背景
  const allowed = ['.ytp-popup,', '.ytp-settings-menu {', 'tp-yt-app-drawer#guide,', 'ytd-guide-renderer,', '#guide-wrapper,', '#guide-content {'];
  globalSelectors.forEach((line) => {
    assert.ok(allowed.includes(line), `非預期的全域選擇器: ${line}`);
  });
});

// ------------------------------------------------ service worker 純函式

test('yarClampWindowSize: 夾擠到合法範圍，非數字回傳 null', () => {
  assert.strictEqual(worker.yarClampWindowSize('1920', 1080), null);
  assert.strictEqual(worker.yarClampWindowSize(NaN, 1080), null);
  assert.strictEqual(worker.yarClampWindowSize(undefined, undefined), null);

  assert.deepStrictEqual(plain(worker.yarClampWindowSize(1920, 1080)), { width: 1920, height: 1080 });
  assert.deepStrictEqual(plain(worker.yarClampWindowSize(10, 10)), { width: 400, height: 300 });
  assert.deepStrictEqual(plain(worker.yarClampWindowSize(99999, 99999)), { width: 7680, height: 4320 });
});

test('yarBuildPopupUrl: 走 watch 頁 + hash 標記，不用會被拒絕的 /embed/', () => {
  assert.strictEqual(
    worker.yarBuildPopupUrl('aqz-KE-bpKQ', 24),
    'https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=24s#yar-popup'
  );
  assert.doesNotMatch(worker.yarBuildPopupUrl('aqz-KE-bpKQ', 24), /\/embed\//, '頂層開 /embed/ 會回錯誤 153');
  assert.match(worker.yarBuildPopupUrl('aqz-KE-bpKQ', -5), /&t=0s#/);
  assert.match(worker.yarBuildPopupUrl('aqz-KE-bpKQ', 'abc'), /&t=0s#/);
});

test('yarBuildPopupUrl: 拒絕會污染 URL 的 videoId', () => {
  ['', 'short', 'aqz-KE-bpKQ&x=1', '../../evil', 'javascript:alert(1)', null, 42, 'a'.repeat(50)].forEach((bad) => {
    assert.strictEqual(worker.yarBuildPopupUrl(bad, 0), null, `應拒絕: ${String(bad)}`);
  });
});

test('yarBuildPopupPlayerCss: 收起頁首與推薦欄，播放器撐滿視窗', () => {
  const css = cssOnly(sandbox.yarBuildPopupPlayerCss());
  ['#masthead-container', '#secondary', 'ytd-watch-metadata'].forEach((sel) => {
    assert.ok(css.includes(sel), `應收起 ${sel}`);
  });
  assert.match(css, /width: 100vw !important/);
  assert.match(css, /height: 100vh !important/);
  // 全部規則都必須綁在 popup 標記上，不能外洩到一般 watch 頁
  css.split('\n').map((l) => l.trim()).filter((l) => /^[#.:a-z]/.test(l) && l.endsWith(',') || l.endsWith('{'))
    .filter((l) => l !== '{' && !l.startsWith('}'))
    .forEach((line) => {
      assert.match(line, /:root\[yar-popup\]/, `未綁定 popup 標記: ${line}`);
    });
});

test('yarBuildPlayerCss: YouTube 原生劇院/滿版模式不套用兩欄扣除', () => {
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080'));
  const override = css.match(/ytd-watch-flexy\[is-two-columns_\][^{]*\{/);
  assert.ok(override, '應有兩欄覆寫規則');
  assert.match(override[0], /:not\(\[theater\]\)/, '必須排除原生劇院模式');
  assert.match(override[0], /:not\(\[full-bleed-player\]\)/, '必須排除滿版播放器模式');

  // 兩欄版面規則同樣不得在劇院模式下生效
  css.split('\n').filter((l) => l.includes('#columns') || l.includes('#primary.') || l.includes('#secondary.'))
    .forEach((line) => {
      if (line.includes('[is-two-columns_]')) {
        assert.match(line, /:not\(\[theater\]\)/, `兩欄版面選擇器需排除劇院模式: ${line.trim()}`);
      }
    });
});

test('yarBuildPlayerCss: 原生劇院/滿版模式下每一條選擇器都不生效', () => {
  // YouTube 原生滿版模式本來就是滿版貼合，我們一旦介入就會把 --ytd-watch-flexy-player-width
  // 一起改掉，而 YouTube 拿同一個變數去算 #primary 寬度，導致 primary+secondary 溢出視窗。
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080'));
  const selectors = css
    .split('{')[0] === css ? [] : css.split('\n').map((l) => l.trim())
      .filter((l) => l.startsWith('ytd-watch-flexy'));
  assert.ok(selectors.length > 0, '應該有選擇器可檢查');
  selectors.forEach((line) => {
    assert.match(line, /:not\(\[full-bleed-player\]\)/, `未排除原生滿版模式: ${line}`);
  });
});

// ------------------------------------------------ 視窗尺寸（依畫質）

test('yarFitWindowSize: 寬與高都必須夾到螢幕可用範圍', () => {
  // 1920 寬的播放器 + 標題列，在 1680x1050 的螢幕上：只夾寬度會長出 1080 高而超出螢幕
  const popup = sandbox.yarFitWindowSize(1920, 0, 28, 1680, 1050);
  assert.ok(popup.width <= 1680, `寬度需夾到螢幕: ${popup.width}`);
  assert.ok(popup.height <= 1050, `高度需夾到螢幕: ${popup.height}`);
});

test('yarFitWindowSize: 內容區必須精準等於長寬比（外框不參與縮放）', () => {
  // 這是黑邊的根因：把固定像素的視窗外框一起等比縮放，內容區就不再是 16:9
  [[1920, 0, 28, 1680, 1050], [1920, 0, 171, 1680, 1050], [3840, 456, 120, 1440, 900]].forEach(
    ([w, ew, eh, aw, ah]) => {
      const size = sandbox.yarFitWindowSize(w, ew, eh, aw, ah);
      const contentW = size.width - ew;
      const contentH = size.height - eh;
      assert.ok(
        Math.abs(contentW / contentH - 16 / 9) < 0.01,
        `內容區應為 16:9，實得 ${contentW}x${contentH} = ${(contentW / contentH).toFixed(3)}`
      );
    }
  );
});

test('yarFitWindowSize: 支援非 16:9 影片的長寬比', () => {
  const size = sandbox.yarFitWindowSize(1440, 0, 30, 5000, 5000, 4 / 3);
  assert.strictEqual(size.width, 1440);
  assert.strictEqual(size.height, Math.round(1440 / (4 / 3)) + 30);
});

test('yarFitWindowSize: 螢幕夠大時不放大，維持原生尺寸', () => {
  const size = sandbox.yarFitWindowSize(1280, 0, 28, 3840, 2160);
  assert.strictEqual(size.width, 1280);
  assert.strictEqual(size.height, Math.round((1280 * 9) / 16) + 28);
});

test('yarFitWindowSize: 一般視窗要把側欄寬度算進去', () => {
  const extraWidth = sandbox.YAR_LAYOUT.SIDEBAR_WIDTH + sandbox.YAR_LAYOUT.COLUMN_GAP;
  const size = sandbox.yarFitWindowSize(1280, extraWidth, 0, 5000, 5000);
  assert.strictEqual(size.width, 1280 + extraWidth);
});
