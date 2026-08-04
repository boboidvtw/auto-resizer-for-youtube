#!/usr/bin/env bash
# run-e2e.sh — 啟動獨立 Brave 實例載入本擴充功能，跑完端到端測試後關閉
# Created: 2026-08-03
#
# Chrome 137+ 已停用 --load-extension，必須用 Brave。
set -euo pipefail

EXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
PORT="${PORT:-9350}"
PROFILE="$(mktemp -d /tmp/yar-e2e-profile.XXXXXX)"
VIDEO="${VIDEO:-https://www.youtube.com/watch?v=aqz-KE-bpKQ}"
# builtin = 內建 Retina；uhd = 外接 4K。座標必須是「所有螢幕構成的全域座標系」，
# 不是每台螢幕各自的 0,0。實機用 chrome.system.display.getInfo() 量到的排列是：
#   內建   bounds 0,0      1710x1107  workArea top=34
#   4K TV  bounds 1710,0   3840x2160  workArea top=30
# 因此 4K 的視窗要開在 x=1710 以後。跑之前先確認排列沒變（螢幕左右對調座標就會不同）。
SCREEN="${SCREEN:-builtin}"

case "$SCREEN" in
  builtin) WIN_SIZE="1600,1000"; WIN_POS="0,40" ;;
  uhd)     WIN_SIZE="3840,2080"; WIN_POS="1710,40" ;;
  *) echo "SCREEN 只能是 builtin 或 uhd（收到: $SCREEN）"; exit 1 ;;
esac

[ -x "$BRAVE" ] || { echo "找不到 Brave: $BRAVE"; exit 1; }

cleanup() { pkill -f "$PROFILE" 2>/dev/null || true; sleep 1; rm -rf "$PROFILE"; }
trap cleanup EXIT

echo "啟動 Brave (port $PORT, 螢幕 $SCREEN $WIN_SIZE @$WIN_POS)，載入 $EXT"
# --window-position 的 y 給 40 以避開 macOS 選單列，否則視窗會被系統下推截短
"$BRAVE" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --mute-audio \
  --window-size="$WIN_SIZE" --window-position="$WIN_POS" "$VIDEO" >/dev/null 2>&1 &

echo "等待頁面載入..."
sleep 25
node "$EXT/tests/e2e.js" "$PORT"
