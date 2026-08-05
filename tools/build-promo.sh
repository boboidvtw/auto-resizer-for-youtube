#!/usr/bin/env bash
# build-promo.sh — 由向量來源產生 Chrome Web Store 的宣傳圖與商店圖示素材
# Created: 2026-08-05
#
# 依賴：rsvg-convert（brew install librsvg），與 icons/build.sh 同一套工具。
# 改宣傳圖只需改 store-assets/promo-small.svg 再跑本腳本；
# 商店圖示則跟著 icons/icon.svg 走，與工具列圖示共用同一個向量來源，不會彼此漂移。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEOMETRY="$ROOT/tools/png-geometry.js"
cd "$ROOT/store-assets"

command -v rsvg-convert >/dev/null 2>&1 || {
  echo "缺少 rsvg-convert，請先執行：brew install librsvg" >&2
  exit 1
}

# ── Small promo tile ─────────────────────────────────────────────────────────
# 商店規格：固定 440x280，PNG 或 JPEG
rsvg-convert -w 440 -h 280 promo-small.svg -o promo-small-440x280.png
echo "已產生 store-assets/promo-small-440x280.png"
# 尺寸自我檢查：商店對素材尺寸零容忍，差一像素就退件
node "$GEOMETRY" promo-small-440x280.png --expect-size 440x280

# ── Store icon ───────────────────────────────────────────────────────────────
# 商店圖示與 manifest 的 icons/icon.png **不是同一張**：兩者都是 128x128，但商店要求
# 圖形只佔中央 96x96、四周留 16px 透明邊。直接拿滿版的 icon.png 去填會被判留白不足，
# 而那個錯誤從檔案總管看不出來（尺寸完全一樣）。
STORE_ICON_CANVAS=128
STORE_ICON_CONTENT=96
STORE_ICON_PAD=$(( (STORE_ICON_CANVAS - STORE_ICON_CONTENT) / 2 ))

# --page-* / --top / --left 需要 rsvg-convert 2.52+。舊版會直接以未知參數失敗，
# 萬一某版本收下參數卻不照做，下一行的幾何檢查也會擋住 —— 兩層都是 fail loud。
rsvg-convert \
  -w "$STORE_ICON_CONTENT" -h "$STORE_ICON_CONTENT" \
  --page-width "$STORE_ICON_CANVAS" --page-height "$STORE_ICON_CANVAS" \
  --top "$STORE_ICON_PAD" --left "$STORE_ICON_PAD" \
  ../icons/icon.svg -o store-icon-128.png
echo "已產生 store-assets/store-icon-128.png"

# 這裡一定要驗留白而不只驗尺寸：忘了加 --page-*/--top/--left 的輸出照樣是 128x128。
node "$GEOMETRY" store-icon-128.png \
  --expect-size "${STORE_ICON_CANVAS}x${STORE_ICON_CANVAS}" \
  --expect-content "${STORE_ICON_PAD},${STORE_ICON_PAD},${STORE_ICON_CONTENT},${STORE_ICON_CONTENT}"
