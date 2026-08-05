#!/usr/bin/env bash
#
# build.sh — 由 icon.svg 產生擴充功能所需的四種點陣圖示
# Rasterises icon.svg into the four sizes Chrome asks for.
#
# Created: 2026-08-05
# 依賴：rsvg-convert（brew install librsvg）。改動圖示只需改 icon.svg 再跑本腳本，
# 四個 PNG 因此不可能彼此漂移。
set -euo pipefail

cd "$(dirname "$0")"

command -v rsvg-convert >/dev/null 2>&1 || {
  echo "缺少 rsvg-convert，請先執行：brew install librsvg" >&2
  exit 1
}

for size in 16 32 48 128; do
  case "$size" in
    128) out="icon.png" ;;          # manifest 的 128 用的是這個檔名
    *)   out="icon-${size}.png" ;;
  esac
  rsvg-convert -w "$size" -h "$size" icon.svg -o "$out"
  echo "已產生 ${out} (${size}x${size})"
done
