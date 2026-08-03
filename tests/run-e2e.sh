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

[ -x "$BRAVE" ] || { echo "找不到 Brave: $BRAVE"; exit 1; }

cleanup() { pkill -f "$PROFILE" 2>/dev/null || true; sleep 1; rm -rf "$PROFILE"; }
trap cleanup EXIT

echo "啟動 Brave (port $PORT)，載入 $EXT"
# --window-position 的 y 給 40 以避開 macOS 選單列，否則視窗會被系統下推截短
"$BRAVE" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --mute-audio \
  --window-size=1600,1000 --window-position=0,40 "$VIDEO" >/dev/null 2>&1 &

echo "等待頁面載入..."
sleep 25
node "$EXT/tests/e2e.js" "$PORT"
