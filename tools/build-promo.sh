#!/usr/bin/env bash
# build-promo.sh — 由向量來源產生 Chrome Web Store 的宣傳圖素材
# Created: 2026-08-05
#
# 依賴：rsvg-convert（brew install librsvg），與 icons/build.sh 同一套工具。
# 改宣傳圖只需改 store-assets/promo-small.svg 再跑本腳本。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/store-assets"

command -v rsvg-convert >/dev/null 2>&1 || {
  echo "缺少 rsvg-convert，請先執行：brew install librsvg" >&2
  exit 1
}

# 商店規格：small promo tile 固定 440x280，PNG 或 JPEG
rsvg-convert -w 440 -h 280 promo-small.svg -o promo-small-440x280.png
echo "已產生 store-assets/promo-small-440x280.png (440x280)"

# 尺寸自我檢查：商店對這張圖的尺寸零容忍，差一像素就退件
node -e '
  const fs = require("fs");
  const buf = fs.readFileSync("promo-small-440x280.png");
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== 440 || h !== 280) {
    console.error(`尺寸錯誤：${w}x${h}，商店要求 440x280`);
    process.exit(1);
  }
  console.log(`尺寸確認 ${w}x${h}`);
'
