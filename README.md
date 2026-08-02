# 🎬 YouTube Auto Resizer & Quality Controller v2.1.0

> 依畫質與視窗大小自動調整 YouTube 播放器尺寸，零留白、不溢出、可鎖定畫質。
> Resize the YouTube player to fit your window and quality, lock playback quality, and pop the video out — Manifest V3.

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://www.paypal.me/boboidvtw)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## 📖 功能 (Features)

### 四種尺寸模式 (Four resize modes)

| 模式 Mode | 行為 Behaviour |
|---|---|
| **依畫質自動匹配** `autoByQuality` | 以影片原生解析度為寬度上限（4K → 3840px），再由視窗寬高夾擠到可容納的最大 16:9 尺寸 |
| **強制視窗貼合** `fitWindow` | 忽略畫質，一律撐滿視窗可用空間 |
| **強制劇院模式** `theater` | 播放器滿寬，推薦影片欄移到下方 |
| **預設** `default` | 完全不介入，維持 YouTube 原生版面 |

寬度以 CSS `min()` 表示，因此**縮放視窗時瀏覽器自行重算**，不需要 JS 監聽 resize，也不會因為視窗未最大化而溢出畫面。
Width is expressed as a CSS `min()` expression, so the browser reflows on its own — no JS resize listener, and no horizontal overflow when the window isn't maximised.

### 其他 (Other)

- 🎯 **畫質鎖定**：可指定每支新影片自動鎖定的畫質（2160p ~ 480p）；該影片沒有此畫質時退而取可用的最高畫質。預設為 `auto`（不干預）。
- 🪟 **彈出式播放器**：播放列上的按鈕會把目前影片以獨立視窗開啟並從當前秒數續播，
  視窗內只保留播放器（頁首、推薦欄、影片資訊、留言皆收起）。
  **視窗尺寸跟著畫質走** —— 開啟時依當前畫質決定，播放中畫質變動也會重新調整，
  並等比夾到螢幕可用範圍內（畫質抖動有 1.5 秒冷卻，避免視窗連續跳動）。
  實作上開的是一般 watch 頁加 `#yar-popup` 標記，再由 content script 收版面 ——
  不走 `youtube.com/embed/`，因為該路徑設計給 iframe，直接當頂層視窗開啟時
  YouTube 一律回「錯誤 153 影片播放器設定錯誤」，與影片本身是否允許嵌入無關。
- 📐 **零留白版面**：消除播放器兩側與上方留白；窄視窗下 YouTube 自行收成單欄時會自動跟隨，不硬扣側欄寬度。
- 🔄 **同步瀏覽器視窗尺寸**（預設關閉）：依畫質調整整個瀏覽器視窗大小。

---

## 🚀 安裝 (Installation)

```bash
git clone https://github.com/boboidvtw/youtube-auto-resizer-extension.git
```

1. 開啟 `chrome://extensions`
2. 開啟右上角**開發者模式 (Developer mode)**
3. 點**載入未壓縮擴充功能 (Load unpacked)**，選擇本專案資料夾

---

## 📁 架構 (Architecture)

```
youtube-auto-resizer-extension/
├── manifest.json      # Manifest V3
├── background.js      # Service worker：設定供應、視窗調整、彈出播放器
├── src/
│   ├── config.js      # 設定結構、版面常數、storage 封裝（三端共用）
│   └── layout.js      # 播放器 CSS 產生器（純函式）
├── content.js         # 隔離世界主控：套用樣式、注入主世界腳本、控制列按鈕
├── injected.js        # 主世界：畫質／解析度偵測，回報給隔離世界
├── pageScript.js      # 主世界：透過原生 player API 設定畫質
├── popup.html/js/css  # 設定面板
├── tests/             # 零相依單元測試（node:test + node:vm）
└── icons/
```

**世界分工**：`injected.js` 只偵測、`pageScript.js` 只控制、`content.js` 只套版面。
主世界對同一支影片只廣播一次狀態，隔離世界可透過 `YT_AUTO_RESIZER_REQUEST_STATE` 事件要求重播。

---

## 🧪 測試 (Tests)

```bash
node --test "tests/*.test.js"
```

零相依（Node 內建 test runner + `vm`），涵蓋設定正規化、版面 CSS 產生器與 service worker 的 URL／尺寸驗證。

---

## 📝 v2.1.0 修正 (Changelog)

本版修掉 v2.0 三個「功能整塊失效」的問題：

1. **設定面板完全無效** — popup 寫 `chrome.storage.local` 的扁平鍵，content script 讀 `chrome.storage.sync` 的 `yt_auto_resizer_settings`，兩邊從未對上。現統一為單一 schema，並提供舊設定一次性遷移。
2. **沒有 service worker** — content script 送出的 `GET_SETTINGS` / `RESIZE_WINDOW` / `OPEN_POPUP_PLAYER` 三種訊息都沒有接收端，彈出式播放器按鈕點了沒反應。已補上 `background.js`。
3. **畫質鎖定不存在** — `pageScript.js` 未被任何程式載入（死碼）。現由 content script 一併注入並接上指令通道。

其他：
- 播放器尺寸改用視窗（`100vw/100vh`）而非實體螢幕（`screen.availWidth`）計算，視窗未最大化時不再溢出
- 修正 `#columns` 因 `content-box` + padding 造成的 32px 橫向溢出
- 夾住電影感光暈 `#cinematics`（`scale(1.5, 2)` 的 canvas）避免撐破視窗
- 移除永久輪詢（1.5s／0.5s `setInterval`）與全 DOM `MutationObserver`，改為有界重試
- popup 不再從 Google Fonts 載入遠端字型
- 移除未使用的 `activeTab` 權限；補齊 16/32/48 圖示
- 版本號統一為 2.1.0（v2.0 的 manifest 與 README 不一致）

---

## ❤️ 贊助 (Sponsor)

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://www.paypal.me/boboidvtw)

## 📄 授權 (License)

[MIT License](LICENSE) © 2026 boboidvtw
