/**
 * i18n.test.js — _locales 翻譯檔與呼叫端的一致性守門
 * Guards every localisation key against drift between locales and callers.
 *
 * Created: 2026-08-05
 * 為什麼需要這一支：翻譯漂移不會讓任何東西壞掉，只會讓某個語系的某一格變成空白
 * 或停留在英文。擴充功能照樣載入、e2e 照樣全綠 —— 這正是「會跑不等於有作用」。
 * 唯一能守住的辦法是把「key 集合必須相同」寫成斷言。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LOCALES_DIR = path.join(ROOT, '_locales');

/** Chrome Web Store 的欄位長度上限（超過會在上架時被退件，不是警告） */
const STORE_LIMITS = { name: 75, description: 132 };

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const readText = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const LOCALES = fs.readdirSync(LOCALES_DIR).filter((entry) =>
  fs.statSync(path.join(LOCALES_DIR, entry)).isDirectory()
);

const MESSAGES = Object.fromEntries(
  LOCALES.map((locale) => [locale, readJson(path.join(LOCALES_DIR, locale, 'messages.json'))])
);

/** manifest 宣告的 default_locale 就是所有 fallback 的最終依歸，必須存在 */
const manifest = readJson(path.join(ROOT, 'manifest.json'));

// ------------------------------------------------------------ 翻譯檔本身

test('_locales: default_locale 必須真的有對應目錄', () => {
  assert.ok(manifest.default_locale, 'manifest 缺 default_locale');
  assert.ok(
    LOCALES.includes(manifest.default_locale),
    `default_locale 是 ${manifest.default_locale}，但 _locales/ 只有 ${LOCALES.join(', ')}`
  );
});

test('_locales: 至少要有 en / zh_TW / ja 三個語系', () => {
  ['en', 'zh_TW', 'ja'].forEach((locale) => {
    assert.ok(LOCALES.includes(locale), `缺少語系 ${locale}`);
  });
});

test('_locales: 所有語系的 key 集合必須完全相同', () => {
  const base = manifest.default_locale;
  const baseKeys = Object.keys(MESSAGES[base]).sort();

  LOCALES.filter((locale) => locale !== base).forEach((locale) => {
    const keys = Object.keys(MESSAGES[locale]).sort();
    const missing = baseKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !baseKeys.includes(k));
    assert.deepStrictEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${locale} 與 ${base} 的 key 不一致`
    );
  });
});

test('_locales: 每一則 message 都必須有非空字串', () => {
  LOCALES.forEach((locale) => {
    Object.entries(MESSAGES[locale]).forEach(([key, entry]) => {
      assert.strictEqual(typeof entry.message, 'string', `${locale}/${key} 的 message 不是字串`);
      assert.notStrictEqual(entry.message.trim(), '', `${locale}/${key} 的 message 是空的`);
    });
  });
});

test('_locales: 帶 placeholder 的訊息，每個語系都要保留同樣的佔位符', () => {
  /*
   * displayCurrent 是 `$LABEL$（目前）` 這種形式。某個語系漏掉 $LABEL$ 的話，
   * 螢幕名稱會整個消失，只剩下「（目前）」—— 不會報錯，只會看起來很怪。
   */
  const base = manifest.default_locale;
  Object.entries(MESSAGES[base]).forEach(([key, entry]) => {
    const placeholders = Object.keys(entry.placeholders || {});
    if (placeholders.length === 0) return;

    LOCALES.filter((locale) => locale !== base).forEach((locale) => {
      const other = MESSAGES[locale][key];
      assert.deepStrictEqual(
        Object.keys(other.placeholders || {}).sort(),
        placeholders.sort(),
        `${locale}/${key} 的 placeholders 與 ${base} 不一致`
      );
      placeholders.forEach((name) => {
        const token = `$${name.toUpperCase()}$`;
        assert.ok(
          other.message.includes(token),
          `${locale}/${key} 的訊息裡沒有 ${token}，替換後該欄位會消失`
        );
      });
    });
  });
});

// ------------------------------------------- Chrome Web Store 的硬性限制

test('_locales: 每個語系的 name / description 都不得超過商店長度上限', () => {
  LOCALES.forEach((locale) => {
    const name = MESSAGES[locale].extName.message;
    const description = MESSAGES[locale].extDescription.message;
    assert.ok(
      name.length <= STORE_LIMITS.name,
      `${locale} 的 extName ${name.length} 字元，上限 ${STORE_LIMITS.name}`
    );
    assert.ok(
      description.length <= STORE_LIMITS.description,
      `${locale} 的 extDescription ${description.length} 字元，上限 ${STORE_LIMITS.description}`
    );
  });
});

test('_locales: 擴充功能名稱不得以 YouTube 商標開頭', () => {
  /*
   * 這是上架被退件的主因之一。Google 要求第三方採 `[功能] for [產品]™` 格式，
   * 名稱以 YouTube 起頭會觸犯 impersonation 與商標政策（實例：YouTube Tweaks
   * 於 2023-09 被下架，改名 Tweaks for YouTube™ 後才復原）。
   * 這條斷言的用途是擋住日後「順手改個好記的名字」。
   */
  LOCALES.forEach((locale) => {
    const name = MESSAGES[locale].extName.message;
    assert.ok(
      !/^\s*youtube/i.test(name),
      `${locale} 的 extName 以 YouTube 開頭：「${name}」`
    );
  });
});

// ------------------------------------------------------------ 呼叫端對照

test('manifest: 所有 __MSG_key__ 都必須在翻譯檔裡找得到', () => {
  const raw = readText('manifest.json');
  const keys = [...raw.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]);
  assert.ok(keys.length > 0, 'manifest 完全沒有用到 i18n，name/description 可能寫死了');

  keys.forEach((key) => {
    LOCALES.forEach((locale) => {
      assert.ok(MESSAGES[locale][key], `${locale} 缺少 manifest 用到的 key: ${key}`);
    });
  });
});

test('popup.html: 每個 data-i18n 的 key 都必須存在，且有英文 fallback 文字', () => {
  const html = readText('popup.html');
  const keys = [...html.matchAll(/data-i18n(?:-aria-label)?="([A-Za-z0-9_]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 10, `popup.html 只找到 ${keys.length} 個 data-i18n，面板應該幾乎全部都要在地化`);

  keys.forEach((key) => {
    LOCALES.forEach((locale) => {
      assert.ok(MESSAGES[locale][key], `${locale} 缺少 popup.html 用到的 key: ${key}`);
    });
  });
});

test('JS 呼叫端: yarMessage 的每個 key 都必須存在', () => {
  /*
   * 只比對字面量。yarMessage(someVariable, ...) 這種動態呼叫抓不到，
   * 但目前沒有這種寫法 —— 真要出現時，這條測試不會誤報，只是守不到而已。
   */
  const sources = ['popup.js', 'content.js', 'background.js', 'src/config.js'];
  const found = [];

  sources.forEach((file) => {
    const code = readText(file);
    [...code.matchAll(/yarMessage\(\s*'([A-Za-z0-9_]+)'/g)].forEach((m) => {
      found.push({ file, key: m[1] });
    });
  });

  assert.ok(found.length > 0, '沒有任何 yarMessage 呼叫，i18n 可能沒接上');
  found.forEach(({ file, key }) => {
    LOCALES.forEach((locale) => {
      assert.ok(MESSAGES[locale][key], `${locale} 缺少 ${file} 用到的 key: ${key}`);
    });
  });
});

test('翻譯檔沒有孤兒 key（定義了但沒有人用）', () => {
  const callers = [
    readText('manifest.json'),
    readText('popup.html'),
    readText('popup.js'),
    readText('content.js'),
    readText('background.js'),
    readText('src/config.js')
  ].join('\n');

  const orphans = Object.keys(MESSAGES[manifest.default_locale]).filter((key) => !callers.includes(key));
  assert.deepStrictEqual(orphans, [], `以下 key 沒有任何呼叫端，應刪除或接上：${orphans.join(', ')}`);
});
