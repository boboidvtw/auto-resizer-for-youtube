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
      storage: {
        sync: { get: noop, set: noop },
        local: { get: noop, remove: noop },
        session: { get: noop, set: noop }
      },
      windows: { update: noop, create: noop },
      tabs: { onRemoved: { addListener: noop } }
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

test('預留空間：只扣頁面內距與捲軸，絕不預扣側欄', () => {
  const scrollbar = sandbox.YAR_LAYOUT.SCROLLBAR_RESERVE;
  assert.strictEqual(sandbox.yarReservePageWidth(true), scrollbar, '零留白模式只需保留捲軸');
  assert.strictEqual(sandbox.yarReservePageWidth(false), sandbox.YAR_LAYOUT.PAGE_PADDING + scrollbar);

  // 這是「自動調整等於沒作用」的根因：預扣 400px 側欄後，播放器上限剛好等於
  // YouTube 原生兩欄寬度（1600px 視窗實測 1128px vs 原生 1112px，只差 16px）。
  [true, false].forEach((removeSideGaps) => {
    assert.ok(
      sandbox.yarReservePageWidth(removeSideGaps) < sandbox.YAR_LAYOUT.SIDEBAR_WIDTH,
      '預留空間不得包含側欄寬度'
    );
  });
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
  assert.match(css, /calc\(100vw - 16px\)/, '零留白模式只扣捲軸');
  assert.match(css, /calc\(\(100vh - 80px\) \* 16 \/ 9\)/, '應同時受視窗高度限制');
});

test('yarBuildPlayerCss: 寬度上限不得預扣側欄（否則等於維持 YouTube 原生尺寸）', () => {
  // 迴歸守門：1600x863 視窗實測 default 1112px、預扣側欄的 autoByQuality 1128px，
  // 差 16px 等於使用者看不出任何「自動調整」。
  const sidebar = sandbox.YAR_LAYOUT.SIDEBAR_WIDTH;
  ['autoByQuality', 'fitWindow'].forEach((resizeMode) => {
    [true, false].forEach((removeSideGaps) => {
      const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode, removeSideGaps }), 'hd2160');
      const widthCap = css.match(/calc\(100vw - (\d+)px\)/);
      assert.ok(widthCap, `${resizeMode} 應有視窗寬度上限`);
      assert.ok(
        Number(widthCap[1]) < sidebar,
        `${resizeMode}/removeSideGaps=${removeSideGaps} 預扣了 ${widthCap[1]}px，含側欄寬度`
      );
    });
  });
});

test('yarBuildPlayerCss: autoByQuality 與 fitWindow 必須產生不同結果', () => {
  // 兩者曾經因為被同一個 472px 側欄扣除夾死而輸出完全相同的 CSS，模式選單形同虛設
  ['hd2160', 'hd1080', 'hd720', 'large'].forEach((quality) => {
    const auto = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'autoByQuality' }), quality);
    const fit = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'fitWindow' }), quality);
    assert.notStrictEqual(auto, fit, `${quality} 下兩種模式不應產生相同 CSS`);
    assert.match(auto, new RegExp(`min\\(${sandbox.YAR_QUALITY_WIDTH[quality]}px,`));
  });
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

test('yarBuildPlayerCss: 側欄放不下時要能自動換行到播放器下方', () => {
  // 播放器優先取空間、側欄撿剩下的；擠不下就換行。換行判斷交給瀏覽器，
  // 縮放視窗時才會即時切換，也不需要 JS 監聽 resize。
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080'));
  const columnsRule = css.match(/#columns\.ytd-watch-flexy \{[^}]*\}/);
  assert.ok(columnsRule, '應接管 #columns');
  assert.match(columnsRule[0], /flex-flow: row wrap/, '#columns 必須允許換行');

  // 同名選擇器有兩個區塊（box-sizing 與版面），取真正設定 flex 的那一塊
  const secondaryRule = (css.match(/#secondary\.ytd-watch-flexy \{[^}]*\}/g) || [])
    .find((block) => block.includes('flex:'));
  assert.ok(secondaryRule, '應接管 #secondary');
  assert.match(
    secondaryRule,
    new RegExp(`flex: 1 1 ${sandbox.YAR_LAYOUT.SIDEBAR_WIDTH}px`),
    '側欄須可伸縮並以原寬度為 flex-basis'
  );
  assert.doesNotMatch(secondaryRule, /max-width: \d+px/, '側欄不得被硬鎖寬度，否則換行後無法撐滿');
});

test('yarBuildPlayerCss: 不再依賴 [is-two-columns_] 這個 Polymer 私有屬性', () => {
  ['autoByQuality', 'fitWindow', 'theater'].forEach((resizeMode) => {
    const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({ resizeMode }), 'hd1080'));
    assert.doesNotMatch(css, /is-two-columns_/, `${resizeMode} 不應相依 YouTube 私有屬性`);
  });
});

test('yarBuildPlayerCss: 接管寬度的容器一律 border-box（避免 padding 造成橫向溢出）', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080');
  assert.match(css, /box-sizing: border-box !important/);
});

test('yarBuildPlayerCss: 劇院模式改為單欄堆疊', () => {
  const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'theater' }), 'hd1080');
  assert.match(css, /flex-direction: column/);
  assert.doesNotMatch(css, /width: 400px/, '劇院模式不應固定側欄寬度');
});

test('yarBuildPlayerCss: 任何模式都必須接管欄位版面（否則放大後溢出視窗）', () => {
  // --ytd-watch-flexy-player-width 同時是 YouTube 算 #primary 寬度的來源，
  // 只放大播放器卻不接管欄位，#primary + 側欄會直接撐破視窗。
  [true, false].forEach((removeSideGaps) => {
    ['autoByQuality', 'fitWindow', 'theater'].forEach((resizeMode) => {
      const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({ resizeMode, removeSideGaps }), 'hd1080'));
      assert.match(css, /#columns\.ytd-watch-flexy \{/, `${resizeMode}/${removeSideGaps} 應接管 #columns`);
      assert.match(css, /box-sizing: border-box !important/);
    });
  });
});

test('yarBuildPlayerCss: 頁面內距與寬度預留量必須一致（否則播放器比容器寬）', () => {
  [true, false].forEach((removeSideGaps) => {
    ['autoByQuality', 'theater'].forEach((resizeMode) => {
      const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({ resizeMode, removeSideGaps }), 'hd2160'));
      const columnsRule = css.match(/#columns\.ytd-watch-flexy \{[^}]*\}/)[0];
      const padding = Number(columnsRule.match(/padding: 0 (\d+)px/)[1]) * 2;
      const reserved = Number(css.match(/calc\(100vw - (\d+)px\)/)[1]);
      assert.ok(
        reserved >= padding,
        `${resizeMode}/removeSideGaps=${removeSideGaps}: 預留 ${reserved}px 少於實際內距 ${padding}px`
      );
    });
  });
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

test('彈出播放器分頁登記：去重、可移除、不修改輸入', () => {
  // 彈出視窗的身分不能靠 URL hash（YouTube 會 replaceState 清掉，且與 content script
  // 執行時機是競態）。改由 service worker 記住自己開的分頁 id 來回答。
  const original = Object.freeze([7, 9]);
  assert.deepStrictEqual(plain(worker.yarAddPopupTab(original, 11)), [7, 9, 11]);
  assert.deepStrictEqual(plain(worker.yarAddPopupTab(original, 9)), [7, 9], '重複登記不應長大');
  assert.deepStrictEqual(plain(worker.yarAddPopupTab(undefined, 3)), [3], '沒有既有紀錄時也要能登記');
  assert.deepStrictEqual(plain(worker.yarAddPopupTab(original, 'abc')), [7, 9], '非數字 id 一律忽略');
  assert.deepStrictEqual(plain(worker.yarRemovePopupTab(original, 7)), [9]);
  assert.deepStrictEqual(plain(worker.yarRemovePopupTab(undefined, 7)), []);
  assert.deepStrictEqual(plain(original), [7, 9], '不得修改輸入陣列');
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

test('yarBuildPlayerCss: 欄位版面規則不得在 YouTube 原生劇院/滿版模式下生效', () => {
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({}), 'hd1080'));
  css.split('\n').map((l) => l.trim())
    .filter((l) => l.includes('#columns') || l.includes('#primary.') || l.includes('#secondary.'))
    .forEach((line) => {
      assert.match(line, /:not\(\[theater\]\)/, `欄位版面選擇器需排除原生劇院模式: ${line}`);
      assert.match(line, /:not\(\[full-bleed-player\]\)/, `欄位版面選擇器需排除滿版模式: ${line}`);
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

test('yarFitWindowSize: 內容區以外的固定寬度原樣加回', () => {
  const extraWidth = sandbox.YAR_LAYOUT.PAGE_PADDING + sandbox.YAR_LAYOUT.SCROLLBAR_RESERVE;
  const size = sandbox.yarFitWindowSize(1280, extraWidth, 0, 5000, 5000);
  assert.strictEqual(size.width, 1280 + extraWidth);
});
