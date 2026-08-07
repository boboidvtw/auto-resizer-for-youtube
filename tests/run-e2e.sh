#!/usr/bin/env bash
# run-e2e.sh — 啟動獨立 Brave 實例載入本擴充功能，跑完端到端測試後關閉
# Created: 2026-08-03
# Updated: 2026-08-06（螢幕位置改為執行期偵測；開啟自動播放以取得影片中繼資料）
#
# Chrome 137+ 已停用 --load-extension，必須用 Brave。
#
# 用法：
#   bash tests/run-e2e.sh                    內建螢幕
#   SCREEN=uhd bash tests/run-e2e.sh         外接 4K（沒接就大聲失敗，不會靜默跑錯螢幕）
#   VIDEO=https://... bash tests/run-e2e.sh  指定影片（直式影片驗證用）
set -euo pipefail

EXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
PORT="${PORT:-9350}"
PROFILE="$(mktemp -d /tmp/yar-e2e-profile.XXXXXX)"
VIDEO="${VIDEO:-https://www.youtube.com/watch?v=aqz-KE-bpKQ}"

# 螢幕代號交給 tests/pick-screen.js 在執行期解析（builtin / uhd / largest / primary）。
# 舊版把 4K 的位置寫死成 1710,40 —— 螢幕排列一改就開到錯的地方，而且不會有任何錯誤訊息：
# 測試照樣跑完，只是量到的是另一台螢幕的數字，4K 專屬門檻要嘛被靜默略過、要嘛拿內建螢幕
# 的結果去比 4K 的標準。現在改為問 chrome.system.display 的真值，要求的螢幕不存在就中止。
SCREEN="${SCREEN:-builtin}"

[ -x "$BRAVE" ] || { echo "找不到 Brave: $BRAVE"; exit 1; }

cleanup() { pkill -f "$PROFILE" 2>/dev/null || true; sleep 1; rm -rf "$PROFILE"; }
trap cleanup EXIT

echo "啟動 Brave (port $PORT)，載入 $EXT"
#
# ⚠️ 這裡**刻意不給 --window-size / --window-position**（2026-08-06 實測後移除）。
# Brave 會把這兩個旗標套用到之後每一個 chrome.windows.create 出來的視窗上，
# 完全覆蓋 API 指定的 left/top/width/height。實測同一支探測腳本：
#   有旗標：要求 {left:1762, top:30, 3737x2130} -> 實得 {left:0, top:40, 1280x800}
#   無旗標：要求 {left:1762, top:30, 3737x2130} -> 實得 {left:1762, top:30, 3737x2130}
# 後果不是測試變紅，而是測試**通過但什麼都沒守到**：舊版把主視窗開在 1710,40，
# 彈出視窗也被旗標放到 1710,40，於是「彈出視窗開在來源視窗所在的螢幕」必然成立 ——
# 那條檢查驗的是命令列旗標，不是擴充功能的定位邏輯。
# 主視窗的位置改由 pick-screen.js 用 chrome.windows.update 設定（那條路徑不受影響）。
#
# --autoplay-policy：全新 profile 的媒體互動分數為零，YouTube 會擋掉自動播放，
# 影片中繼資料因此不會載入、`video.videoWidth` 永遠是 0。長寬比檢查在那種狀態下會退回
# 16:9 基準，於是「驗證直式影片」會退化成拿 16:9 比 16:9 的假通過。
"$BRAVE" --remote-debugging-port="$PORT" --user-data-dir="$PROFILE" \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --mute-audio \
  --autoplay-policy=no-user-gesture-required \
  "https://www.youtube.com/" >/dev/null 2>&1 &

echo "等待瀏覽器啟動..."
sleep 12

echo "依真實螢幕排列定位視窗 (SCREEN=$SCREEN)..."
node "$EXT/tests/pick-screen.js" "$PORT" "$SCREEN"

# 影片一律先開首頁再導航過去，不從命令列冷啟。理由見 tests/goto.js 的檔頭：
# 冷啟 /watch 網址時 YouTube 對直式影片一律送 padded 的 16:9 串流，
# 於是「非 16:9 版面」那條路徑永遠測不到，而且是安靜地測不到。
echo "導航到影片..."
node "$EXT/tests/goto.js" "$PORT" "$VIDEO"

echo "等待版面重排..."
sleep 12

node "$EXT/tests/e2e.js" "$PORT"
