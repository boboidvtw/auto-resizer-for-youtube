/**
 * png-geometry.test.js — 守 PNG 幾何檢查工具本身
 * Created: 2026-08-05
 *
 * 為什麼要測「檢查工具」：商店圖示的留白規格全靠 tools/png-geometry.js 守。
 * 那支工具若哪天退化成「永遠回傳整張都是內容」或「永遠通過」，不會有任何東西變紅，
 * 商店素材就在沒人看得見的情況下失去守門 —— 同 v2.2.0 的教訓：
 * 沒有對照組的「沒退步」等於沒守門。
 *
 * 對照組就是 repo 裡現成的兩張圖：
 *   icons/icon.png            滿版 128x128（manifest 用）
 *   store-assets/store-icon-128.png  128x128 畫布、內容 96x96、四周 16px 透明邊（商店用）
 * 它們尺寸完全相同、只差在留白，正好是「只驗尺寸擋不住」的那一類差異。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { measure } = require('../tools/png-geometry.js');

const ROOT = path.join(__dirname, '..');
const FULL_BLEED_ICON = path.join(ROOT, 'icons/icon.png');
const STORE_ICON = path.join(ROOT, 'store-assets/store-icon-128.png');
const PROMO_TILE = path.join(ROOT, 'store-assets/promo-small-440x280.png');

// 商店規格：128 畫布、96 內容、四周 (128-96)/2 = 16 的透明邊
const STORE_ICON_SPEC = { canvas: 128, content: 96, pad: 16 };

test('商店圖示：畫布 128、內容 96、四周 16px 透明邊', () => {
  const { width, height, content, alphaMeasured } = measure(STORE_ICON);
  assert.strictEqual(alphaMeasured, true, '應該真的量到 alpha，而不是走「無 alpha」的退路');
  assert.strictEqual(width, STORE_ICON_SPEC.canvas);
  assert.strictEqual(height, STORE_ICON_SPEC.canvas);
  assert.deepStrictEqual(content, {
    x: STORE_ICON_SPEC.pad,
    y: STORE_ICON_SPEC.pad,
    width: STORE_ICON_SPEC.content,
    height: STORE_ICON_SPEC.content,
  });
});

test('對照組：manifest 的滿版圖示尺寸相同，但內容佔滿整張（留白為 0）', () => {
  const { width, height, content } = measure(FULL_BLEED_ICON);
  assert.strictEqual(width, STORE_ICON_SPEC.canvas, '兩張圖的畫布尺寸本來就一樣');
  assert.strictEqual(height, STORE_ICON_SPEC.canvas);
  assert.deepStrictEqual(content, { x: 0, y: 0, width: 128, height: 128 });
});

test('兩張圖只驗尺寸分不出來，量了留白才分得出來（這條檢查的存在理由）', () => {
  const store = measure(STORE_ICON);
  const fullBleed = measure(FULL_BLEED_ICON);
  assert.strictEqual(store.width, fullBleed.width);
  assert.strictEqual(store.height, fullBleed.height);
  assert.notDeepStrictEqual(store.content, fullBleed.content);
});

test('沒有 alpha 通道的素材：回報整張為內容，並標明未量 alpha', () => {
  // promo tile 由 rsvg-convert 產生為不透明 PNG。這條防的是「把無 alpha 誤判成全透明」——
  // 那會讓邊界框變成 0x0，看起來像素材壞了。
  const { width, height, content, alphaMeasured } = measure(PROMO_TILE);
  assert.strictEqual(alphaMeasured, false);
  assert.deepStrictEqual(content, { x: 0, y: 0, width, height });
  assert.strictEqual(width, 440);
  assert.strictEqual(height, 280);
});
