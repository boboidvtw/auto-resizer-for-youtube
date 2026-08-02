# Project Context & Handoff Log - YouTube Auto Resizer & Quality Controller

> Last Closed: 2026-08-02T23:40:00+08:00 (v2.1.0)

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

## 🎯 Next Session Goals

- Service worker 的三個訊息處理**只有純函式被單元測試覆蓋**，端到端行為（視窗真的被調整、
  彈出視窗真的開啟）尚未在真實 Chrome 驗證過——因為 `--load-extension` 已不可用。
  下次可考慮手動在 Chrome 載入未壓縮擴充功能後，用 claude-in-chrome 連上驗證。
- embed 播放器對停用嵌入的影片會失敗，可加偵測後退回 `watch?v=` 彈出視窗。
- 觀察 Chromium 更新後 YouTube Polymer 版面變化（`is-two-columns_` 屬性名是外部相依）。
