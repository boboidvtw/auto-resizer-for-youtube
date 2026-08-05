#!/usr/bin/env bash
# store-screenshots.sh — 啟動獨立 Brave 實例載入本擴充功能，產生商店截圖素材
# Created: 2026-08-05
#
# Chrome 137+ 已停用 --load-extension，必須用 Brave（同 tests/run-e2e.sh）。
# 影片預設用 Big Buck Bunny：Creative Commons 授權，拿來當商店截圖不會有版權問題。
set -euo pipefail

EXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
PORT="${PORT:-9351}"
PROFILE="$(mktemp -d /tmp/yar-shots-profile.XXXXXX)"
VIDEO="${VIDEO:-https://www.youtube.com/watch?v=aqz-KE-bpKQ}"

[ -x "$BRAVE" ] || { echo "找不到 Brave: $BRAVE"; exit 1; }

cleanup() { pkill -f "$PROFILE" 2>/dev/null || true; sleep 1; rm -rf "$PROFILE"; }
trap cleanup EXIT

echo "啟動 Brave (port $PORT)，載入 $EXT"
# --autoplay-policy：全新 profile 的媒體互動分數是零，影片不會自動播，
# 截到的會是停在 0:00 的全黑畫面加一顆大播放鍵 —— 當商店素材等於在展示壞掉的畫面。
"$BRAVE" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --mute-audio \
  --autoplay-policy=no-user-gesture-required \
  --window-size="1600,1000" --window-position="0,40" "$VIDEO" >/dev/null 2>&1 &

echo "等待頁面載入..."
sleep 25
node "$EXT/tools/store-screenshots.js" "$PORT"
