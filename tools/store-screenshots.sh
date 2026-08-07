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
#
# ⚠️ --window-size/--window-position 只在這支腳本安全，別複製到會開彈出式播放器的腳本。
# 2026-08-06 實測：Brave 會把這兩個旗標套用到後續每一次 chrome.windows.create，
# 靜默蓋掉 API 要求的 left/top/width/height（要 {left:1762, top:30, 3737x2130}，
# 實得 {left:0, top:40, 1280x800}）。tests/run-e2e.sh 因此拿掉了這兩個旗標，
# 改由 tests/pick-screen.js 用 chrome.windows.update 定位並自我檢查。
# 這裡安全的理由：本腳本只截觀看頁與設定面板分頁，從不點 #yt-resizer-popup-btn
# （store-screenshots.js 只讀它存不存在當健檢），所以完全不經過 chrome.windows.create；
# 截圖尺寸也是靠 Emulation.setDeviceMetricsOverride 決定，與視窗實際大小無關。
"$BRAVE" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --mute-audio \
  --autoplay-policy=no-user-gesture-required \
  --window-size="1600,1000" --window-position="0,40" "$VIDEO" >/dev/null 2>&1 &

echo "等待頁面載入..."
sleep 25
node "$EXT/tools/store-screenshots.js" "$PORT"
