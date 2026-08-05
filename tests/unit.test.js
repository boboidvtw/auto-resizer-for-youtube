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
  'YAR_WINDOW_RESIZE_COOLDOWN_MS',
  'YAR_DISPLAY_TIER',
  'YAR_UHD_MIN_WIDTH',
  'YAR_HIDPI_MIN_WIDTH',
  'YAR_MAX_DPR',
  'YAR_POPUP_TARGETS'
];

function loadSandbox() {
  const context = vm.createContext({ console });
  ['src/config.js', 'src/display.js', 'src/layout.js'].forEach((file) => {
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
      windows: { update: noop, create: noop, get: noop, getLastFocused: noop },
      tabs: { onRemoved: { addListener: noop } },
      system: { display: { getInfo: noop } }
    }
  });
  ['src/config.js', 'src/display.js', 'background.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  });
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
  // 每個欄位都刻意給非預設值，才驗得出「原樣保留」而不是「剛好等於預設」
  const input = Object.freeze({
    enabled: false,
    resizeMode: 'theater',
    preferredQuality: '1440p',
    removeSideGaps: false,
    resizeMainWindow: true,
    displayAwareQuality: false,
    autoQualityCeiling: 'hd1440',
    popupTargetDisplay: 'largest'
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

// ============================================================ 4K / 多螢幕適配
//
// 本區塊全部針對 v2.3.0 的多螢幕支援。設計背景見 memory/project_context.md：
// 實測這台機器 chrome.system.display 在 macOS 回傳的 dpiX/dpiY 恆為 0、name 恆為空字串，
// 因此「螢幕的 DPR」只能由 content script 的 devicePixelRatio 取得，且僅限視窗所在那台。
// 所有純函式都必須容許 dpr 未知。

/** 實測值（2026-08-04，Brave + chrome.system.display.getInfo()） */
const REAL_DISPLAYS = [
  {
    id: '1',
    bounds: { left: 0, top: 0, width: 1710, height: 1107 },
    workArea: { left: 0, top: 34, width: 1710, height: 1073 },
    isInternal: true,
    isPrimary: true
  },
  {
    id: '2',
    bounds: { left: 1710, top: 0, width: 3840, height: 2160 },
    workArea: { left: 1710, top: 30, width: 3840, height: 2130 },
    isInternal: false,
    isPrimary: false
  }
];

/**
 * 把 layout.js 產生的寬度運算式在指定 viewport 下求值成實際像素。
 *
 * 這是整個 4K 區塊得以成為「守門」而非「裝飾」的關鍵。v2.2.0 的教訓是：
 * 斷言「CSS 字串裡有 100vw」在功能整個失效時照樣會通過（當時 20/20 全綠、實際只放大 16px）。
 * 求值成數字之後，門檻才擋得住東西。
 */
function evalWidthExpression(expr, vw, vh) {
  const js = expr
    .replace(/calc/g, '')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/100vw/g, String(vw))
    .replace(/100vh/g, String(vh))
    .replace(/(\d)px/g, '$1');
  const residue = js.replace(/Math\.(min|max)/g, '');
  if (!/^[-+*/(),.\d\s]*$/.test(residue)) {
    throw new Error(`寬度運算式含非算術符號，無法安全求值: ${expr}`);
  }
  return Function(`"use strict"; return (${js});`)();
}

/** 從產生的 CSS 取出 --yar-player-w 的運算式並求值 */
function playerWidthAt(css, vw, vh) {
  const match = css.match(/--yar-player-w:\s*([^;]+);/);
  assert.ok(match, 'CSS 應宣告 --yar-player-w');
  return evalWidthExpression(match[1].trim(), vw, vh);
}

/** 兩台螢幕最大化後的實際 viewport（扣掉 macOS 選單列與 Brave 外框，實測值） */
const VIEWPORT_UHD = { vw: 3840, vh: 2050 };
const VIEWPORT_BUILTIN = { vw: 1710, vh: 997 };

// ------------------------------------------------------------ 顯示器分級

test('yarClassifyDisplay: dpr 已知時用實體像素分級', () => {
  // 內建 Retina：邏輯 1710 看起來很小，實體 3420 才是畫質需求的真正依據
  const builtin = sandbox.yarClassifyDisplay(REAL_DISPLAYS[0], 2);
  assert.strictEqual(builtin.logicalWidth, 1710);
  assert.strictEqual(builtin.physicalWidth, 3420);
  assert.strictEqual(builtin.tier, sandbox.YAR_DISPLAY_TIER.HIDPI);

  const uhd = sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], 1);
  assert.strictEqual(uhd.physicalWidth, 3840);
  assert.strictEqual(uhd.tier, sandbox.YAR_DISPLAY_TIER.UHD);
});

test('yarClassifyDisplay: dpr 未知時退回邏輯寬度，且不得當成 0 或 NaN', () => {
  // macOS 的 chrome.system.display 不提供 dpi（實測 dpiX === 0）。
  // 早期設計想用 dpr = dpiX / 96，那會讓每一台螢幕的實體寬度都變成 0。
  [null, undefined, 0, NaN, -1, 'garbage'].forEach((badDpr) => {
    const uhd = sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], badDpr);
    assert.strictEqual(uhd.dpr, null, `dpr=${String(badDpr)} 應視為未知`);
    assert.strictEqual(uhd.physicalWidth, null, '未知 dpr 不得推算實體像素');
    assert.strictEqual(uhd.tier, sandbox.YAR_DISPLAY_TIER.UHD, '3840 邏輯寬本身就足以判定 UHD');

    const builtin = sandbox.yarClassifyDisplay(REAL_DISPLAYS[0], badDpr);
    assert.strictEqual(
      builtin.tier,
      sandbox.YAR_DISPLAY_TIER.STANDARD,
      'dpr 未知時只能保守判定，不得憑空升級'
    );
  });
});

test('yarClassifyDisplay: dpr 有上界（它有一條來自訊息的路徑）', () => {
  // popup 送 GET_DISPLAYS 時會把自己的 devicePixelRatio 一併傳給 service worker。
  // 不夾上界的話，一個離譜的數字就能把任何螢幕推成 UHD 分級，連帶把畫質請求推到最高。
  const builtin = sandbox.yarClassifyDisplay(REAL_DISPLAYS[0], 999);
  assert.strictEqual(builtin.dpr, sandbox.YAR_MAX_DPR, `dpr 應夾到 ${sandbox.YAR_MAX_DPR}`);
  assert.strictEqual(builtin.physicalWidth, 1710 * sandbox.YAR_MAX_DPR);

  // 縮小頁面時 dpr 可以低於 1，那是合法的，不能連下界一起夾
  const zoomedOut = sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], 0.5);
  assert.strictEqual(zoomedOut.dpr, 0.5);
  assert.strictEqual(zoomedOut.physicalWidth, 1920);

  // 畫質決策走同一條夾擠，否則繞過 classify 直接呼叫就沒防到
  assert.strictEqual(
    sandbox.yarQualityForPlayer(1000, 999, 'highres'),
    sandbox.yarQualityForPlayer(1000, sandbox.YAR_MAX_DPR, 'highres')
  );
});

test('yarClassifyDisplay: 不修改輸入、缺欄位不炸', () => {
  const frozen = Object.freeze({
    bounds: Object.freeze({ left: 0, top: 0, width: 3840, height: 2160 }),
    isInternal: false
  });
  const result = sandbox.yarClassifyDisplay(frozen, 1);
  assert.strictEqual(result.tier, sandbox.YAR_DISPLAY_TIER.UHD);
  assert.notStrictEqual(result, frozen);

  assert.strictEqual(sandbox.yarClassifyDisplay(null, 2), null);
  assert.strictEqual(sandbox.yarClassifyDisplay({}, 2), null);
  assert.strictEqual(sandbox.yarClassifyDisplay({ bounds: { width: 0, height: 0 } }, 2), null);
});

test('yarDescribeDisplay: macOS 的 name 是空字串，必須自行組出可辨識標籤', () => {
  // 實測 chrome.system.display 在 macOS 的 name 恆為 ''，不能拿來當 UI 標籤
  const builtin = sandbox.yarDescribeDisplay(sandbox.yarClassifyDisplay(REAL_DISPLAYS[0], 2));
  const uhd = sandbox.yarDescribeDisplay(sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], 1));
  assert.match(builtin, /Built-in/, '未注入標籤時退回英文（default_locale 是 en）');
  assert.match(builtin, /1710\s*[x×]\s*1107/);
  assert.match(builtin, /@2x/);
  assert.match(uhd, /External/);
  assert.match(uhd, /3840\s*[x×]\s*2160/);
  assert.notStrictEqual(builtin, uhd, '兩台螢幕的標籤必須可區分');
});

test('yarDescribeDisplay: 在地化標籤由呼叫端注入，display.js 本身不碰 chrome.i18n', () => {
  /*
   * 這條守的是 v3.0 的 i18n 邊界：display.js 同時被 service worker 與本測試載入，
   * 一旦有人圖方便在裡面直接呼叫 chrome.i18n，node 的沙箱就會炸 ReferenceError。
   * 注入版與預設版必須都能運作。
   */
  const zhTw = { internal: '內建', external: '外接', unknown: '未知螢幕' };
  const builtin = sandbox.yarDescribeDisplay(sandbox.yarClassifyDisplay(REAL_DISPLAYS[0], 2), zhTw);
  const uhd = sandbox.yarDescribeDisplay(sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], 1), zhTw);
  assert.match(builtin, /內建 1710×1107 @2x/);
  assert.match(uhd, /外接 3840×2160/);
  assert.strictEqual(sandbox.yarDescribeDisplay(null, zhTw), '未知螢幕');
  assert.strictEqual(sandbox.yarDescribeDisplay(null), 'Unknown display');

  // 只給一半的標籤時，缺的那一半要退回英文而不是變成 undefined
  assert.match(sandbox.yarDescribeDisplay(sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], 1), { internal: '內建' }), /External/);
});

// ------------------------------------------------------------ 螢幕選擇

test('yarDisplayForWindow: 依視窗中心點判定所在螢幕', () => {
  const pick = (bounds) => {
    const d = sandbox.yarDisplayForWindow(REAL_DISPLAYS, bounds);
    return d && d.id;
  };
  assert.strictEqual(pick({ left: 0, top: 40, width: 900, height: 700 }), '1');
  assert.strictEqual(pick({ left: 1710, top: 70, width: 1600, height: 1000 }), '2');
  // 跨螢幕時以中心點所在為準：左緣 1310 + 半寬 800 = 2110，落在 4K 上
  assert.strictEqual(pick({ left: 1310, top: 70, width: 1600, height: 1000 }), '2');
  // 完全在螢幕外（例如剛拔掉螢幕）要退回主螢幕而非回傳 null
  assert.strictEqual(pick({ left: 99999, top: 99999, width: 800, height: 600 }), '1');
  assert.strictEqual(pick({ left: 0, top: 0, width: 0, height: 0 }), '1');
});

test('yarPickTargetDisplay: follow / internal / largest 三種偏好', () => {
  const { FOLLOW, INTERNAL, LARGEST } = sandbox.YAR_POPUP_TARGETS;
  assert.strictEqual(sandbox.yarPickTargetDisplay(REAL_DISPLAYS, FOLLOW, '2').id, '2');
  assert.strictEqual(sandbox.yarPickTargetDisplay(REAL_DISPLAYS, FOLLOW, '1').id, '1');
  assert.strictEqual(sandbox.yarPickTargetDisplay(REAL_DISPLAYS, INTERNAL, '2').id, '1');
  assert.strictEqual(sandbox.yarPickTargetDisplay(REAL_DISPLAYS, LARGEST, '1').id, '2', '4K 面積最大');

  // 未知偏好 / 找不到 currentId → 退回主螢幕，絕不回傳 null
  assert.strictEqual(sandbox.yarPickTargetDisplay(REAL_DISPLAYS, 'nonsense', '1').id, '1');
  assert.strictEqual(sandbox.yarPickTargetDisplay(REAL_DISPLAYS, FOLLOW, 'ghost').id, '1');
  assert.strictEqual(sandbox.yarPickTargetDisplay([], LARGEST, '1'), null, '沒有螢幕才回傳 null');
  assert.strictEqual(sandbox.yarPickTargetDisplay(null, LARGEST, '1'), null);

  // 單螢幕時三種偏好結果一致
  const solo = [REAL_DISPLAYS[0]];
  [FOLLOW, INTERNAL, LARGEST].forEach((pref) => {
    assert.strictEqual(sandbox.yarPickTargetDisplay(solo, pref, '1').id, '1');
  });
});

// ------------------------------------------------------------ 畫質決策

test('yarQualityForPlayer: 依「播放器實體像素」而非 CSS 像素選畫質', () => {
  // 這是多螢幕的核心：兩台螢幕的 CSS 寬差很多，實體像素卻接近，需要的畫質也就接近
  assert.strictEqual(sandbox.yarQualityForPlayer(1630, 2, 'hd2160'), 'hd2160', '內建 1630×2 = 3260');
  assert.strictEqual(sandbox.yarQualityForPlayer(3502, 1, 'hd2160'), 'hd2160', '4K 3502×1 = 3502');
  assert.strictEqual(sandbox.yarQualityForPlayer(1630, 1, 'hd2160'), 'hd1080', '同樣寬度但 DPR 1 只需 1080p');
  assert.strictEqual(sandbox.yarQualityForPlayer(1200, 1, 'hd2160'), 'hd720');
});

test('yarQualityForPlayer: 受上限夾住', () => {
  assert.strictEqual(sandbox.yarQualityForPlayer(3502, 1, 'hd1080'), 'hd1080');
  assert.strictEqual(sandbox.yarQualityForPlayer(3502, 1, 'hd1440'), 'hd1440');
  // 上限比需求高時不得把畫質往上灌
  assert.strictEqual(sandbox.yarQualityForPlayer(800, 1, 'highres'), 'large');
});

test('yarQualityForPlayer: 無效輸入回傳 null（代表不干預）', () => {
  [[0, 2], [-100, 2], [NaN, 2], ['1600', 2], [undefined, 2]].forEach(([w, d]) => {
    assert.strictEqual(sandbox.yarQualityForPlayer(w, d, 'hd2160'), null, `寬度 ${String(w)} 應不干預`);
  });
  // dpr 無效時退回 1 而不是放棄：CSS 寬度本身仍是有效資訊
  assert.strictEqual(sandbox.yarQualityForPlayer(1630, null, 'hd2160'), 'hd1080');
  assert.strictEqual(sandbox.yarQualityForPlayer(1630, 0, 'hd2160'), 'hd1080');
  // 上限無效時退回預設上限，不得回傳 undefined
  assert.strictEqual(sandbox.yarQualityForPlayer(3502, 1, 'garbage'), 'hd2160');
});

test('yarQualityAliasFor: 內部代碼可轉回 popup 用的標籤（送 SET_QUALITY 需要）', () => {
  assert.strictEqual(sandbox.yarQualityAliasFor('hd2160'), '2160p');
  assert.strictEqual(sandbox.yarQualityAliasFor('large'), '480p');
  assert.strictEqual(sandbox.yarQualityAliasFor('nope'), null);
  // 與 YAR_QUALITY_ALIAS 必須是嚴格互逆，避免兩份對照表漂移
  Object.entries(plain(sandbox.YAR_QUALITY_ALIAS)).forEach(([label, code]) => {
    if (code === 'auto') return;
    assert.strictEqual(sandbox.yarQualityAliasFor(code), label, `${code} 反查應得 ${label}`);
  });
});

test('yarShouldUpscale: 影片本身就不夠高解析度時才允許放大', () => {
  const available4K = ['hd2160', 'hd1440', 'hd1080', 'hd720'];
  const available1080 = ['hd1080', 'hd720', 'large'];

  assert.strictEqual(sandbox.yarShouldUpscale('hd2160', available4K), false, '拿得到 4K 就不必放大');
  assert.strictEqual(sandbox.yarShouldUpscale('hd2160', available1080), true, '影片最高只有 1080p');
  assert.strictEqual(sandbox.yarShouldUpscale('hd1080', available1080), false);

  // 尚未取得可用畫質清單時一律保守：不放大
  [[], null, undefined, 'garbage'].forEach((bad) => {
    assert.strictEqual(sandbox.yarShouldUpscale('hd2160', bad), false, `清單 ${String(bad)} 應保守處理`);
  });
  assert.strictEqual(sandbox.yarShouldUpscale(null, available1080), false);

  // 清單來自主世界的 YouTube player 物件（頁面可控），不得沿原型鏈取值。
  // 用 `YAR_QUALITY_WIDTH[code] || 0` 的話 '__proto__' 會取到物件、'constructor' 取到函式，
  // 兩者都是 truthy，Math.max 得到 NaN，之後的比較全部靜默失真。
  assert.strictEqual(
    sandbox.yarShouldUpscale('hd2160', ['__proto__', 'constructor', 'toString']),
    false,
    '原型鏈上的鍵不得被當成有效畫質'
  );
  assert.strictEqual(
    sandbox.yarShouldUpscale('hd2160', ['hd1080', '__proto__']),
    true,
    '混入原型鏈鍵時仍應正確判斷真正的最高畫質'
  );
  assert.strictEqual(sandbox.yarShouldUpscale('__proto__', available1080), false);
});

// ------------------------------------- 版面：4K 上的放大卡死與側欄拉寬

test('4K 守門：autoByQuality 播 1080p 時被畫質上限鎖在 1920px（記錄現況）', () => {
  // 這條記錄「為什麼需要 allowUpscale」。在 3840 寬的 viewport 上，
  // 畫質原生寬 1920 變成主要限制，播放器只用掉視窗的一半——
  // 而同一段程式在內建螢幕（1710 寬）上，1920 從來不是限制，所以量不出這個 bug。
  const css = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'autoByQuality' }), 'hd1080');
  const width = playerWidthAt(css, VIEWPORT_UHD.vw, VIEWPORT_UHD.vh);
  assert.strictEqual(width, 1920, '未允許放大時應維持原生上限');

  const builtin = playerWidthAt(css, VIEWPORT_BUILTIN.vw, VIEWPORT_BUILTIN.vh);
  assert.ok(builtin < 1920, `內建螢幕上 1920 不該是限制，實得 ${builtin}`);
});

test('4K 守門：允許放大後必須真的撐開，且不得溢出視窗', () => {
  const css = sandbox.yarBuildPlayerCss(
    settingsFor({ resizeMode: 'autoByQuality' }),
    'hd1080',
    { allowUpscale: true }
  );
  const width = playerWidthAt(css, VIEWPORT_UHD.vw, VIEWPORT_UHD.vh);

  // 門檻寫死：至少要用掉視窗寬的 85%，否則就是又一次「只放大 16px」
  assert.ok(width >= VIEWPORT_UHD.vw * 0.85, `4K 上只長到 ${Math.round(width)}px，未達視窗寬的 85%`);
  assert.ok(width >= 1920 * 1.7, `相對被鎖死的 1920px 至少要放大 1.7 倍，實得 ${Math.round(width)}px`);
  assert.ok(width <= VIEWPORT_UHD.vw, `不得溢出視窗: ${Math.round(width)} > ${VIEWPORT_UHD.vw}`);

  // 高度同樣不得溢出（16:9 推導）
  const height = (width * 9) / 16;
  assert.ok(height <= VIEWPORT_UHD.vh, `高度溢出視窗: ${Math.round(height)} > ${VIEWPORT_UHD.vh}`);
});

test('allowUpscale 不得影響內建螢幕的既有行為（防窄修補全套退步）', () => {
  ['hd2160', 'hd1440', 'hd1080', 'hd720'].forEach((quality) => {
    const base = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'autoByQuality' }), quality);
    const upscaled = sandbox.yarBuildPlayerCss(
      settingsFor({ resizeMode: 'autoByQuality' }),
      quality,
      { allowUpscale: true }
    );
    const before = playerWidthAt(base, VIEWPORT_BUILTIN.vw, VIEWPORT_BUILTIN.vh);
    const after = playerWidthAt(upscaled, VIEWPORT_BUILTIN.vw, VIEWPORT_BUILTIN.vh);
    assert.ok(after >= before, `${quality}: 允許放大後反而變小 (${before} -> ${after})`);
    assert.ok(after <= VIEWPORT_BUILTIN.vw, `${quality}: 內建螢幕溢出 ${after}`);
  });
});

test('第三參數省略時行為與舊版完全一致（既有呼叫端不得被改壞）', () => {
  ['hd2160', 'hd1080', 'hd720', 'large'].forEach((quality) => {
    ['autoByQuality', 'fitWindow', 'theater'].forEach((resizeMode) => {
      const withoutArg = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode }), quality);
      const withEmpty = sandbox.yarBuildPlayerCss(settingsFor({ resizeMode }), quality, {});
      assert.strictEqual(withoutArg, withEmpty, `${resizeMode}/${quality} 預設值不一致`);
    });
  });
});

test('防漂移：yarPlayerWidthFor 必須與 CSS 運算式算出同一個數字', () => {
  // content.js 需要在 JS 裡知道播放器能長多大（才能反推該要什麼畫質），
  // 而版面用的是 CSS min()。兩份公式一旦漂移，畫質決策就會依據一個不存在的尺寸做出來。
  const viewports = [
    VIEWPORT_UHD, VIEWPORT_BUILTIN,
    { vw: 3840, vh: 1200 }, { vw: 1200, vh: 900 }, { vw: 700, vh: 700 }, { vw: 1900, vh: 700 }
  ];
  ['autoByQuality', 'fitWindow', 'theater'].forEach((resizeMode) => {
    [true, false].forEach((removeSideGaps) => {
      ['hd2160', 'hd1440', 'hd1080', 'hd720', 'small'].forEach((quality) => {
        [true, false].forEach((allowUpscale) => {
          const settings = settingsFor({ resizeMode, removeSideGaps });
          const css = sandbox.yarBuildPlayerCss(settings, quality, { allowUpscale });
          viewports.forEach(({ vw, vh }) => {
            const fromCss = playerWidthAt(css, vw, vh);
            const fromJs = sandbox.yarPlayerWidthFor(settings, quality, vw, vh, { allowUpscale });
            assert.strictEqual(
              Math.round(fromJs),
              Math.round(fromCss),
              `${resizeMode}/${quality}/upscale=${allowUpscale} @${vw}x${vh}: JS ${fromJs} != CSS ${fromCss}`
            );
          });
        });
      });
    });
  });
});

test('yarPlayerWidthFor: viewport 無效時回傳 null', () => {
  const settings = settingsFor({});
  [[0, 900], [1600, 0], [NaN, 900], ['1600', 900], [undefined, undefined]].forEach(([vw, vh]) => {
    assert.strictEqual(sandbox.yarPlayerWidthFor(settings, 'hd1080', vw, vh, {}), null);
  });
});

test('4K 守門：側欄並排時不得被 flex-grow 拉寬（#columns 需有寬度上限）', () => {
  // 4K 上播放器 1920、視窗 3840，剩下的 1900px 會被 flex: 1 1 400px 的側欄全部吃掉，
  // 推薦影片卡片被拉成 1900px 寬。限制 #columns 的總寬，多餘空間才會變成置中留白。
  const css = cssOnly(sandbox.yarBuildPlayerCss(settingsFor({ resizeMode: 'autoByQuality' }), 'hd1080'));
  const columnsRule = css.match(/#columns\.ytd-watch-flexy \{[^}]*\}/)[0];

  const maxWidth = columnsRule.match(/max-width:\s*([^;]+);/);
  assert.ok(maxWidth, '#columns 應宣告 max-width');
  assert.match(maxWidth[1], /var\(--yar-player-w\)/, 'max-width 必須跟著播放器寬度走');
  assert.match(
    maxWidth[1],
    new RegExp(`${sandbox.YAR_LAYOUT.SIDEBAR_WIDTH}`),
    'max-width 應留出剛好一個側欄的空間'
  );

  // 有了 max-width 就必須置中，否則整塊會靠左、右邊留一條空白
  assert.match(columnsRule, /margin-left: auto !important/);
  assert.match(columnsRule, /margin-right: auto !important/);

  // 側欄本身仍不得被硬鎖寬度（換行後要能撐滿）
  const secondaryRule = (css.match(/#secondary\.ytd-watch-flexy \{[^}]*\}/g) || [])
    .find((block) => block.includes('flex:'));
  assert.doesNotMatch(secondaryRule, /max-width: \d+px/, '限制應加在 #columns 而非 #secondary');
});

// ------------------------------------------------------------ 設定欄位

// ------------------------------------------------------------ 視窗定位

test('yarFitIntoWorkArea: 放得下就照給並置中於目標螢幕', () => {
  const uhdWorkArea = REAL_DISPLAYS[1].workArea;   // { left: 1710, top: 30, 3840x2130 }
  const placed = sandbox.yarFitIntoWorkArea(1920, 1080, uhdWorkArea);
  assert.strictEqual(placed.width, 1920, '放得下就不縮');
  assert.strictEqual(placed.height, 1080);
  assert.strictEqual(placed.left, 1710 + (3840 - 1920) / 2, '應置中於 4K 螢幕');
  assert.strictEqual(placed.top, 30 + (2130 - 1080) / 2);

  // 座標必須落在目標螢幕內，否則系統會把視窗推回主螢幕
  assert.ok(placed.left >= uhdWorkArea.left);
  assert.ok(placed.left + placed.width <= uhdWorkArea.left + uhdWorkArea.width);
});

test('yarFitIntoWorkArea: 放不下時等比縮小，不得變形', () => {
  const builtinWorkArea = REAL_DISPLAYS[0].workArea;   // { left: 0, top: 34, 1710x1073 }
  const placed = sandbox.yarFitIntoWorkArea(3840, 2160, builtinWorkArea);
  assert.ok(placed.width <= 1710 && placed.height <= 1073, `未塞進工作區: ${placed.width}x${placed.height}`);
  assert.ok(
    Math.abs(placed.width / placed.height - 3840 / 2160) < 0.01,
    `長寬比跑掉: ${placed.width}x${placed.height}`
  );
  assert.ok(placed.top >= builtinWorkArea.top, 'top 必須避開選單列');
});

test('yarFitIntoWorkArea: 工作區缺漏或尺寸無效時的退路', () => {
  assert.deepStrictEqual(
    plain(sandbox.yarFitIntoWorkArea(960, 580, null)),
    { left: 0, top: 0, width: 960, height: 580 },
    '沒有工作區資訊時原樣回傳，不得回 null 讓呼叫端開不出視窗'
  );
  assert.deepStrictEqual(
    plain(sandbox.yarFitIntoWorkArea(960, 580, { width: 0, height: 0 })),
    { left: 0, top: 0, width: 960, height: 580 }
  );
  assert.strictEqual(sandbox.yarFitIntoWorkArea(0, 580, REAL_DISPLAYS[0].workArea), null);
  assert.strictEqual(sandbox.yarFitIntoWorkArea(NaN, NaN, REAL_DISPLAYS[0].workArea), null);
});

test('yarSizeFromFitRequest: 用目標螢幕的工作區算尺寸，不吃頁面端的螢幕數字', () => {
  // 實測 Brave 的指紋防護會把 YouTube 頁面看到的 screen.* 竄改成 1680x1050，
  // 而真實外接螢幕是 3840x2160。若尺寸還由頁面端算，4K 上的視窗會小一半。
  const uhd = sandbox.yarClassifyDisplay(REAL_DISPLAYS[1], null);
  const builtin = sandbox.yarClassifyDisplay(REAL_DISPLAYS[0], null);
  const fit = { playerWidth: 3840, extraWidth: 0, extraHeight: 28, aspectRatio: 16 / 9 };

  const onUhd = worker.yarSizeFromFitRequest(fit, uhd);
  const onBuiltin = worker.yarSizeFromFitRequest(fit, builtin);
  assert.ok(onUhd.width > onBuiltin.width * 1.8,
    `4K 上應該明顯比內建大: ${onUhd.width} vs ${onBuiltin.width}`);
  assert.ok(onUhd.width <= REAL_DISPLAYS[1].workArea.width, '不得超出 4K 工作區');
  assert.ok(onBuiltin.width <= REAL_DISPLAYS[0].workArea.width, '不得超出內建工作區');

  // 內容區必須維持長寬比（黑邊的根因）
  [[onUhd, uhd], [onBuiltin, builtin]].forEach(([size]) => {
    const ratio = size.width / (size.height - 28);
    assert.ok(Math.abs(ratio - 16 / 9) < 0.02, `內容區長寬比跑掉: ${ratio.toFixed(3)}`);
  });
});

test('yarSizeFromFitRequest: 無效請求與無螢幕資訊的退路', () => {
  assert.strictEqual(worker.yarSizeFromFitRequest(null, null), null);
  assert.strictEqual(worker.yarSizeFromFitRequest({}, null), null);
  assert.strictEqual(worker.yarSizeFromFitRequest({ playerWidth: 0 }, null), null);
  assert.strictEqual(worker.yarSizeFromFitRequest({ playerWidth: '1920' }, null), null);

  // 拿不到螢幕資訊時不得回傳 null（會讓彈出視窗開不出來），改為不夾擠
  const noDisplay = worker.yarSizeFromFitRequest(
    { playerWidth: 1920, extraWidth: 0, extraHeight: 28, aspectRatio: 16 / 9 },
    null
  );
  assert.strictEqual(noDisplay.width, 1920);

  // 長寬比缺漏時退回 16:9
  const noRatio = worker.yarSizeFromFitRequest({ playerWidth: 1920 }, null);
  assert.strictEqual(noRatio.height, Math.round((1920 * 9) / 16));
});

test('service worker 沙箱能載入 display.js（background.js 依賴它）', () => {
  // importScripts 在測試裡是 noop，若忘了把 src/display.js 加進 manifest / importScripts，
  // 真的執行時 background.js 會在第一次定位視窗時炸 ReferenceError。
  assert.strictEqual(typeof worker.yarPickTargetDisplay, 'function');
  assert.strictEqual(typeof worker.yarFitIntoWorkArea, 'function');
  assert.strictEqual(typeof worker.yarResolveTargetDisplay, 'function');
});

test('yarNormalizeSettings: 新增的多螢幕欄位有預設值且會擋非法值', () => {
  const defaults = plain(sandbox.YAR_DEFAULT_SETTINGS);
  assert.strictEqual(defaults.displayAwareQuality, true, '依螢幕自動拉高畫質預設開啟');
  assert.strictEqual(defaults.autoQualityCeiling, 'hd2160');
  assert.strictEqual(defaults.popupTargetDisplay, sandbox.YAR_POPUP_TARGETS.FOLLOW);

  const bad = sandbox.yarNormalizeSettings({
    displayAwareQuality: 'yes',
    autoQualityCeiling: '9001p',
    popupTargetDisplay: 'mars'
  });
  assert.strictEqual(bad.displayAwareQuality, true);
  assert.strictEqual(bad.autoQualityCeiling, 'hd2160');
  assert.strictEqual(bad.popupTargetDisplay, sandbox.YAR_POPUP_TARGETS.FOLLOW);

  const good = sandbox.yarNormalizeSettings({
    displayAwareQuality: false,
    autoQualityCeiling: 'hd1440',
    popupTargetDisplay: sandbox.YAR_POPUP_TARGETS.LARGEST
  });
  assert.strictEqual(good.displayAwareQuality, false);
  assert.strictEqual(good.autoQualityCeiling, 'hd1440');
  assert.strictEqual(good.popupTargetDisplay, 'largest');
});
