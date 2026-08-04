# 🎬 YouTube Auto Resizer & Quality Controller v2.3.0

> 依畫質、視窗大小與**螢幕解析度**自動調整 YouTube 播放器尺寸，零留白、不溢出、可鎖定畫質，支援 4K 與多螢幕。
> Resize the YouTube player to fit your window, quality and **display**, lock playback quality, and pop the video out
> onto the screen you choose — 4K and multi-monitor aware, Manifest V3.

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://www.paypal.me/boboidvtw)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## 📖 功能 (Features)

### 四種尺寸模式 (Four resize modes)

| 模式 Mode | 行為 Behaviour | 1600x863 視窗實測 |
|---|---|---|
| **依畫質自動匹配** `autoByQuality` | 以影片原生解析度為寬度上限（4K → 3840px），再由視窗寬高夾擠到可容納的最大 16:9 尺寸 | 4K 影片 **1392x783**；240p 影片 426x240（不放大糊圖） |
| **強制視窗貼合** `fitWindow` | 忽略畫質，一律撐滿視窗可用空間 | 一律 **1392x783** |
| **強制劇院模式** `theater` | 播放器滿寬，推薦影片欄移到下方 | 1392x783 |
| **預設** `default` | 完全不介入，維持 YouTube 原生版面 | 1112x626 |

**播放器優先取得空間，推薦側欄撿剩下的。** 側欄放不下時由 `#columns` 的 `flex-wrap` 自動換到播放器下方，
換行判斷交給瀏覽器，因此縮放視窗會即時切換、不需要 JS 監聽 resize。
寬度同樣以 CSS `min()` 表示，視窗未最大化時也不會溢出畫面。

The player claims space first; the recommendations rail takes what is left and wraps below when it no longer fits.
Both the wrap decision and the width are pure CSS, so the browser reflows on its own — no JS resize listener.

### 其他 (Other)

- 🎯 **畫質鎖定**：可指定每支新影片自動鎖定的畫質（2160p ~ 480p）；該影片沒有此畫質時退而取可用的最高畫質。預設為 `auto`（不干預）。
- 🪟 **彈出式播放器**：播放列上的按鈕會把目前影片以獨立視窗開啟並從當前秒數續播，
  視窗內只保留播放器（頁首、推薦欄、影片資訊、留言皆收起）。
  **視窗尺寸跟著畫質走** —— 開啟時依當前畫質決定，並以閉環校正讓內容區精準貼合影片長寬比。
  視窗外框（標題列高度）與系統對視窗高度的限制都無法事先算出，因此不採預測式計算，
  改為量測實際內容區後反推修正量，多輪收斂到誤差 &lt; 8px。
  實作上開的是一般 watch 頁加 `#yar-popup` 標記，再由 content script 收版面 ——
  不走 `youtube.com/embed/`，因為該路徑設計給 iframe，直接當頂層視窗開啟時
  YouTube 一律回「錯誤 153 影片播放器設定錯誤」，與影片本身是否允許嵌入無關。
- 📐 **零留白版面**：消除播放器兩側與上方留白；側欄擠不下時自動換行到下方，播放器置中。
- 🔄 **同步瀏覽器視窗尺寸**（預設關閉）：依畫質調整整個瀏覽器視窗大小。
- 🖥️ **螢幕適配（4K / 多螢幕）**：依「播放器 CSS 寬度 × 螢幕 `devicePixelRatio`」推算所需畫質並主動要求。
  影片本身沒有更高畫質時，才會超過原生解析度放大來填滿畫面。可設定自動畫質上限（預設 4K）。
  設定面板會列出偵測到的所有螢幕並標示目前所在那一台。
  Picks playback quality from the player's **physical** pixels (CSS width × DPR), and only upscales past the
  video's native resolution when the video itself has nothing better to offer.
- 🪟 **彈出播放器的開啟螢幕**：可選「跟隨目前視窗 / 最大的螢幕 / 內建螢幕」，尺寸依目標螢幕的工作區計算。

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
│   ├── display.js     # 顯示器分級、螢幕選擇、依螢幕的畫質決策（純函式）
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

**單元測試**（零相依，Node 內建 test runner + `vm`）：

```bash
node --test "tests/*.test.js"
```

涵蓋設定正規化、版面 CSS 產生器、視窗尺寸計算與 service worker 的 URL 驗證。

**端到端測試**（真實載入的擴充功能 + 真實 YouTube + 真實彈出視窗）：

```bash
bash tests/run-e2e.sh                 # 內建螢幕，29 項檢查
SCREEN=uhd bash tests/run-e2e.sh      # 外接 4K 螢幕，35 項檢查（含 4K 專屬門檻）
```

會自動啟動獨立的 Brave 實例、載入本擴充功能，驗證設定面板、放大幅度、兩欄／劇院／彈出視窗後關閉。
其中一項是**對照檢查**：先切到 `default` 量 YouTube 原生尺寸，再切到 `autoByQuality`，
要求播放器至少大 15%。這條就是為了擋住 v2.1 那種「跑得動、測得過、但實際只大 16px」的失效。

> ⚠️ **必須用 Brave，不能用 Chrome**：Chrome 137+ 已停用 `--load-extension`
> 且不會報錯（安靜略過），`--enable-unsafe-extension-debugging` 也救不回來。
> 判斷載入的是否為本擴充功能，要用「絕對路徑 SHA256 前 32 hex 映射 a-p」算出的
> unpacked extension ID 比對——`tests/e2e.js` 已內建此推導。

---

## 📝 v2.3.0 修正 (Changelog)

**4K / 多螢幕適配。** 本機組態：內建 Retina 1710×1107 @2x + 外接 Philips 4K 3840×2160 @1x。

- **`autoByQuality` 的畫質原生寬上限在高解析度螢幕上會變成主要限制**。3840px 寬的視窗播 1080p
  影片時播放器被鎖在 1920px，只用掉視窗的一半；同一段程式在 1710px 的內建螢幕上永遠量不到
  （1920 從來不是 binding constraint）。現在若影片本身已給不出更高畫質（`getAvailableQualityLevels()`
  比對），就拿掉這個上限改為填滿。實測 4K 上 1840 → 3312（+80%）。
- **依螢幕實體像素主動要畫質**。判準是「播放器 CSS 寬 × `devicePixelRatio`」而非 CSS 寬：
  內建 1392×2 = 2784、4K 3312×1 = 3312，兩者 CSS 寬差一倍但需要的畫質相同。
  可設上限（預設 2160p）；使用者明確指定畫質時一律以使用者為準。
- **側欄不再被 `flex-grow` 拉寬**。4K 上播放器 1920、剩下 1900px 會被 `flex: 1 1 400px` 的側欄全吃掉。
  `#columns` 加上 `max-width: min(100%, calc(var(--yar-player-w) + 400px + gap))`，多餘空間變成置中留白。
- **彈出播放器可指定開在哪台螢幕**（跟隨 / 最大 / 內建），並依目標螢幕的 `workArea` 算尺寸與置中定位。
- **視窗尺寸的計算權移到 service worker**。原本用頁面端的 `screen.avail*`，但實測 **Brave 的指紋防護會
  竄改網頁看到的 `screen.*` 與 `screenX/Y`**（同一時刻：YouTube 頁面看到 1680×1050，
  `chrome.system.display` 是 1710×1107 與 3840×2160）。照被竄改的數字算，4K 上的視窗會小一半。
- ⚠️ **macOS 的 `chrome.system.display` 不提供 DPI**：`dpiX`/`dpiY` 恆為 0、`name` 恆為空字串。
  DPR 只能由頁面端提供，且僅涵蓋視窗所在那一台。分級函式因此必須容許 DPR 未知。

新增權限 `system.display`（安裝時不會跳額外警告）。單元測試 32 → 57、e2e 26 → 29（內建）/ 35（4K）。

---

## 📝 v2.2.0 修正 (Changelog)

**「自動調整尺寸」在 v2.1 其實等於沒有作用**，本版是針對這件事的修復。

1. **寬度公式預扣了 400px 側欄** — 播放器上限因此永遠等於 YouTube 原生的兩欄寬度。
   1600x863 視窗實測：原生 1112px、`autoByQuality` 1128px，**只差 16px（1.4%）**，肉眼看不出來。
   而且不論 4K 或 720p 都被同一個數字夾死，`autoByQuality` 與 `fitWindow` 產生的 CSS 一模一樣，
   模式選單形同虛設。改為「播放器先取空間、側欄撿剩下的、擠不下就換行」後，同一情境變成 **1392x783（+25%）**，
   垂直空白從 228px 降到 80px。
2. **`#columns` 的 min-width 由 YouTube 依播放器寬度反推** — 播放器一放大就長出橫向捲軸
   （實測 min-width 被算成 1760px），而且 min-width 撐著，flex 容器永遠不覺得空間不足、側欄也就永遠不換行。已強制歸零。
3. **彈出視窗認不出自己** — 標記放在 URL hash，但 YouTube 的 SPA 會 `replaceState` 清掉它，
   與 content script 在 `document_idle` 執行是競態，慢一步就套用一般版面（頁首、推薦欄全在，尺寸校正失效）。
   改由 service worker 記住自己開的分頁 id（存 `storage.session`，撐過 SW 閒置回收）來回答，不再依賴會被清掉的 hash。
4. **ABR 抖動造成尺寸連跳** — 放大後才看得出來：YouTube 開播時畫質由低往上爬，播放器會跟著跳好幾次。
   現在升畫質立即跟進、降畫質需持續 4 秒才縮。
5. 其他：`#bottom-row` 的 -6px 負邊界在零留白模式下露出 12px 溢出（已就地夾住）；
   側欄換行後播放器置中；不再相依 `[is-two-columns_]` 這個 Polymer 私有屬性；
   單元測試 28 → 32、端到端 20 → 26（新增放大幅度對照與設定面板鏈路）。

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
