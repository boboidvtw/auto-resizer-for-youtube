#!/usr/bin/env bash
# package.sh — 產生 Chrome Web Store 上架用的 zip，並定義「什麼算是擴充功能本體」
# Created: 2026-08-05
#
# 用法：
#   bash tools/package.sh          產生 dist/<name>-v<version>.zip
#   bash tools/package.sh --list   只印出會被打包的檔案（CI 用它決定掃描範圍）
#
# 這份 SHIP 清單是單一真相來源。手動 zip 整個資料夾會把 tests/、tools/、
# store-assets/、memory/、.github/ 一起塞進去 —— 套件肥大，而且等於把開發用的
# 偵錯腳本一起送去給審核員看。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 會進 zip 的東西：擴充功能執行時真正需要的檔案，一個不多。
SHIP=(
  manifest.json
  background.js
  content.js
  injected.js
  pageScript.js
  popup.html
  popup.js
  popup.css
  src
  _locales
  icons/icon-16.png
  icons/icon-32.png
  icons/icon-48.png
  icons/icon.png
  LICENSE
  PRIVACY.md
)

if [ "${1:-}" = "--list" ]; then
  # 展開成實際檔案路徑：CI 要拿它去掃內容，目錄名稱不夠用
  for entry in "${SHIP[@]}"; do
    if [ -d "$entry" ]; then
      find "$entry" -type f
    else
      echo "$entry"
    fi
  done
  exit 0
fi

for entry in "${SHIP[@]}"; do
  [ -e "$entry" ] || { echo "缺少要打包的項目：$entry" >&2; exit 1; }
done

VERSION="$(node -p "require('./manifest.json').version")"
OUT="dist/auto-resizer-for-youtube-v${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# -x 排除 macOS 的 .DS_Store 與資源分支：它們會讓審核端看到莫名其妙的檔案
zip -r -q "$OUT" "${SHIP[@]}" -x "*.DS_Store" -x "__MACOSX/*"

echo "已產生 $OUT"
unzip -l "$OUT" | tail -3
echo
echo "上架前請確認 zip 內沒有 tests/ tools/ store-assets/ memory/："
unzip -l "$OUT" | grep -E "tests/|tools/|store-assets/|memory/|\.github/" && {
  echo "發現不該打包的檔案" >&2
  exit 1
} || echo "確認乾淨"
