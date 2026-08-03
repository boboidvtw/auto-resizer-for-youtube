# Project Context & Handoff Log - YouTube Auto Resizer & Quality Controller

> Last Closed: 2026-08-03T11:50:00+08:00 (v2.1.0, commit 9c5f6a0)

---

## 📌 v2.1.0 — 三個「功能整塊失效」的修復

- [x] **設定面板從未生效**：popup 寫 `chrome.storage.local` 的四個扁平鍵，content script 讀
      `chrome.storage.sync` 的 `yt_auto_resizer_settings`。全 repo 沒有任何 `storage.sync.set`，
      因此 `currentSettings` 永遠等於預設值。現統一 schema 於 `src/config.js`，並在
      `onInstalled` 做舊設定一次性遷移。
- [x] **沒有 service worker**：`GET_SETTINGS` / `RESIZE_WINDOW` / `OPEN_POPUP_PLAYER` 三種訊息
      都沒有接收端。彈出式播放器按鈕每 1.5 秒重新注入，但點下去只會暫停影片。已補 `background.js`。
- [x] **`pageScript.js` 是死碼**：沒有任何程式載入它，而 `setPlaybackQualityRange` 只寫在裡面，
      所以 README 與 repo description 宣傳的「畫質鎖定」從來不存在。現由 content.js 一併注入。

## 📌 版面與效能

- [x] 尺寸計算改用視窗（CSS `min(100vw…, 100vh…)`）而非 `screen.availWidth`。原本視窗未最大化時
      播放器會被設成比視窗還寬。改成 CSS 表達式後也不再需要 JS 監聽 resize。
- [x] `#columns` 是 `content-box`，`width:100%` + `padding:0 16px` 造成 32px 橫向溢出 → 加 `border-box`。
- [x] **電影感光暈 `#cinematics` 是溢出真兇**：一張被 `scale(1.5, 2)` 放大到 2221px 的 canvas，
      播放器放大後會撐破視窗。用 `overflow-x: clip` 夾住（不建立捲動容器，保留垂直光暈）。
- [x] 兩欄扣除只套在 `ytd-watch-flexy[is-two-columns_]`，窄視窗下 YouTube 收成單欄時自動跟隨。
- [x] 移除永久輪詢（`setInterval` 1.5s／0.5s）與全 DOM `MutationObserver`，改為有界重試。
- [x] 主世界對同一支影片只廣播一次狀態 → 新增 `YT_AUTO_RESIZER_REQUEST_STATE` 重播機制，
      避免隔離世界晚一步註冊監聽器就永遠收不到（實測就是這個原因讓畫質鎖定失效）。

---

## 🔬 驗證方式與坑

- **`--load-extension` 在 Chrome 137+ 已失效**，Chrome 150 連 `--enable-unsafe-extension-debugging`
  也救不回來。判斷擴充功能是否真的載入，要用**路徑 SHA256 推算的 extension ID** 去比對
  `/json/list`，不能看到 `chrome-extension://.../service_worker.js` 就以為是自己的（那是別的元件擴充）。
- 替代驗證法：CDP 連上真實 YouTube 分頁 → stub `chrome` API → 依序 eval
  `src/config.js` / `src/layout.js` / `injected.js` / `pageScript.js` / `content.js` → 量測
  `document.documentElement.scrollWidth` 與各容器 rect。
- **連續切換模式量測會有殘影**：前一個模式的 CSS 未重排完就量下一個，會得到假的溢出數字。
  每次切換前先清空樣式並等待，或直接 reload 後單獨量一個模式。
- 單元測試用 `node:vm` 載入 classic script；注意 `const` 宣告不會掛到 global 物件（要明確匯出），
  且跨 realm 物件比較要先 `JSON.parse(JSON.stringify(...))` 攤平。

## ✅ 實測結果（1600x913 視窗，4K 影片）

| 模式 | 播放器 | scrollW | 橫向溢出 |
|---|---|---|---|
| autoByQuality | 1128x635 | 1600 | 否 |
| fitWindow | 1128x635 | 1600 | 否 |
| theater | 1481x833 | 1600 | 否 |
| default | 1112x626 | 1600 | 否 |
| 900px 視窗 + 4K | 852x479 | 900 | 否 |

畫質鎖定實測：設 480p → `getPlaybackQuality()` 由 `hd1080` 變 `large`。
彈出播放器按鈕實測：送出 `OPEN_POPUP_PLAYER`（帶正確 videoId 與續播秒數）。

---

## 🪟 彈出式播放器：三個相扣的問題（2026-08-03 真機測出）

原本走 `youtube.com/embed/`，實測回「錯誤 153 影片播放器設定錯誤」。
原因不是「少數影片停用嵌入」，而是 **embed 路徑是設計給 iframe 的，直接當頂層視窗
開啟時 YouTube 一律拒絕**，與影片本身設定無關（每支影片都會壞）。
改為開一般 watch 頁 + `#yar-popup` 標記，由 content script 收成純播放器。
接著又踩到：

1. **YouTube 會清掉 URL hash**
   SPA 載入後 `replaceState` 移除 `#yar-popup`，於是 `isPopupPlayerWindow()` 之後
   一律回 false → popup 樣式被一般模式覆蓋、尺寸校正失效。
   使用者看到的「影片只佔上半部、下面整片黑」根因就是這個，不是 CSS 寫錯。
   **修法：認出過一次就記住（模組層級 flag），並接受自己掛在 `<html>` 的屬性為佐證。**

2. **預測式視窗尺寸計算治不了量不到的偏差**
   實測要求 900 高只拿到 875，差的 25px 是 macOS 選單列（視窗被放在工作區外遭下推截短），
   而 `outerHeight - innerHeight` 量不到這一段。
   **修法：閉環校正 —— 量實際內容區反推修正量，分 5 輪（400/1200/2500/4000/6000ms）收斂。**

3. **閉環第一版震盪、第二版持續縮小**
   - 震盪：`heightCapped` 每輪重判，但「縮寬」那一輪的高度要求等於目前高度、必然達成，
     下一輪就誤判限制解除又去加高 → 兩狀態無限來回，視窗還每輪微幅長大。
     **系統限制不會消失，必須單向記住。**
   - 持續縮小：高度受限後仍重送 height，每送一次再損失一個選單列高度
     （1600→1557→1512→1468→1423）。**修法：受限後只調寬度，RESIZE_WINDOW 支援單維度更新。**

另加校正次數上限（8）與 8px 收斂容差，避免無效重試。

## 🎭 YouTube 原生劇院/滿版模式：完全不介入

使用者切到原生劇院模式時（`ytd-watch-flexy` 同時有 `theater` 與 `full-bleed-player`），
播放器改掛在滿寬的 `#player-full-bleed-container`。
**關鍵限制：只要動 `--ytd-watch-flexy-player-width`，YouTube 就會拿同一個變數去算 `#primary`
的寬度**，所以「只把播放器放大到滿版」做不到——放大播放器後 primary 變寬，加上 400px
推薦欄就爆出視窗 114px。原生劇院本來就是滿版貼合，我們沒有可增加的價值。
**修法：整份 CSS 每一條選擇器都加 `:not([full-bleed-player])`。**

---

## 🔬 測試環境（重要）

**Chrome 137+ 已停用 `--load-extension`**（不報錯，安靜略過），`--enable-unsafe-extension-debugging`
也救不回來。**但 Brave 仍完整支援**，且彈出視窗會出現在 CDP 目標清單，可直接連上量測：

```bash
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --remote-debugging-port=9345 --user-data-dir=/tmp/xxx-profile \
  --disable-extensions-except="$EXT" --load-extension="$EXT" \
  --no-first-run --no-default-browser-check --mute-audio \
  --window-size=1600,1000 --window-position=0,40 "$URL" &
```

`--window-position` 的 y 給 40 避開 macOS 選單列。
端到端腳本在 scratchpad 的 `e2e.js`（20 項檢查），值得下次重建。

⚠️ **Brave 會偽裝 UA 成 "Google Chrome" 並移除 `navigator.brave`**，不可用 UA 判斷瀏覽器。
⚠️ 判斷擴充功能是否為自己的，要用「絕對路徑 SHA256 前 32 hex 映射 a-p」算 ID 比對。

## ✅ 端到端實測結果（Brave，視窗 1600x1000）

| 項目 | 實測 |
|---|---|
| 一般兩欄 | 播放器 1128x635，scrollW 1600 = viewport，無溢出 |
| 原生劇院 | 完全不介入，播放器滿寬 1600，無溢出 |
| 模式來回切換 | 兩邊都正常恢復 |
| 彈出視窗比例 | 1.779 vs 影片 1.778（誤差 0.06%） |
| 彈出視窗黑邊 | 空隙 0x0 |
| 頁首/推薦欄/彈出按鈕 | 皆已收起 |
| Service worker | 已註冊，共用設定載入成功 |
| 頁面例外 | 0 |

端到端 20/20、單元測試 28/28 綠。

---

## 🎯 Next Session Goals

- [ ] **把 `e2e.js` 收進 repo**（目前只在 scratchpad，會被清掉）。20 項端到端檢查
      + Brave 啟動指令腳本化，讓下次改動能一鍵回歸。
- [ ] **非 16:9 影片的彈出視窗未實測**。長寬比已改用 `video.videoWidth/videoHeight`
      且單元測試涵蓋 4:3，但沒在真機驗過直式影片 / Shorts。
- [ ] **多螢幕情境未測**。`screen.avail*` 在副螢幕上的行為、視窗跨螢幕時的校正收斂。
- [ ] **設定面板端到端未測**：popup.html 改設定 → content script 反應這條鏈路，
      單元測試有覆蓋 schema，但沒在真機點過。可用 Brave CDP 開
      `chrome-extension://<id>/popup.html` 驗證。
- [ ] 觀察 Chromium 更新後 YouTube Polymer 版面變化——
      `is-two-columns_` / `theater` / `full-bleed-player` 三個屬性名都是外部相依，
      YouTube 改名就會全線失效。
