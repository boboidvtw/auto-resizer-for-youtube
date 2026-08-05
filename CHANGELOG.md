# Changelog

本檔記錄所有值得使用者知道的變更。格式參照 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)，
版本號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

## [3.0.0] — 2026-08-05

**上架前的合規整備。** 功能沒有改變，改的是名稱、識別、授權與在地化 —— 這些是
Chrome Web Store 上架的硬性要求，其中三項原本會直接被退件。

### Changed

- **改名為 `Auto Resizer for YouTube™`**（原 `YouTube Auto Resizer & Quality Controller`）。
  Google 要求第三方採 `[功能] for [產品]™` 格式，名稱不得以 YouTube 商標開頭。
  參考案例：擴充功能 *YouTube Tweaks* 於 2023-09 因商標被下架，改名 `Tweaks for YouTube™` 後才復原。
- **全新自製圖示**。原本的紅底白三角與設定面板裡的 SVG，都是 YouTube 官方 logo 的直接複製 ——
  那同時觸犯商標、logo 著作權與 Chrome Web Store 的 impersonation 政策。
  新圖示是沿對角向外展開的雙箭頭（resize 語意），單一向量來源 `icons/icon.svg`，
  四種尺寸由 `icons/build.sh` 產生，因此不可能彼此漂移。
- **設定面板配色由 YouTube 紅改為品牌藍** `#1F6FEB`，與新圖示一致，同時拉開與 YouTube 官方介面的視覺距離。
- **版本徽章改從 manifest 讀取**。原本硬編碼 `v2.3` 而 manifest 是 `2.3.0`，兩份數字遲早漂移且不會有測試會紅。
- `yarDescribeDisplay()` 的「內建 / 外接」改由呼叫端注入。`src/display.js` 同時被 service worker
  與單元測試載入，在裡面直接呼叫 `chrome.i18n` 會讓 node 沙箱炸 ReferenceError。

### Added

- **三語在地化**（`_locales/`）：English、繁體中文、日本語。面板、按鈕、狀態文字全部涵蓋，
  `default_locale` 為 `en`。翻譯缺漏時退回 HTML 裡的英文，不會出現空白欄位。
- **`tests/i18n.test.js`** — 11 條翻譯一致性守門：各語系 key 集合必須相同、訊息不得為空、
  placeholder 必須在每個語系都保留、name/description 不得超過商店長度上限、
  名稱不得以 YouTube 開頭、呼叫端（manifest / popup.html / JS）用到的 key 必須存在、不得有孤兒 key。
  翻譯漂移不會讓任何東西壞掉，只會讓某一格變空白 —— 只有斷言守得住。
- **[`PRIVACY.md`](PRIVACY.md)** 與[託管版隱私權政策](https://labs.moneyai168.com/projects/auto-resizer-for-youtube/privacy.html)。
  上架必要文件。內容可自行查證：本擴充功能沒有任何對外連線。
- **專案首頁**：<https://labs.moneyai168.com/projects/auto-resizer-for-youtube/>
- **GitHub Actions CI**，每次 push 與 PR 都跑完整單元測試。
- `manifest.json` 補上 `author`、`homepage_url`、`minimum_chrome_version`。

### Fixed

- **`LICENSE` 的 MIT 免責條款被改壞**。原文誤植為 `MECHANICAL FOR A PARTICULAR PURPOSE`，
  正確應為 `MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE` —— 「適售性擔保」的排除條款整段不見了。
  後果不只是理論問題：GitHub 的授權偵測因此認不出 MIT，repo 頁面顯示 `Other`，與 README 的 MIT 徽章互相矛盾。
- **贊助連結由 PayPal 改為 Buy Me a Coffee**。PayPal 禁止台灣賣家對台灣買家收款，
  對主要客群而言那顆按鈕點下去必然失敗。
- 彈出播放器按鈕補上 `aria-label`（原本只有 `title`）。

### Security / Privacy

- 無行為變更。經全檔掃描確認：零 `fetch`／`XMLHttpRequest`、零分析工具、零遠端程式碼、
  零廣告攔截邏輯。唯一的對外連結是設定面板底部的贊助連結，且必須由使用者主動點擊。

---

## [2.3.0] — 2026-08-04

**4K / 多螢幕適配。** 開發組態：內建 Retina 1710×1107 @2x + 外接 Philips 4K 3840×2160 @1x。

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

## [2.2.0] — 2026-08-03

**「自動調整尺寸」在 v2.1 其實等於沒有作用**，本版是針對這件事的修復。

1. **寬度公式預扣了 400px 側欄** — 播放器上限因此永遠等於 YouTube 原生的兩欄寬度。
   1600×863 視窗實測：原生 1112px、`autoByQuality` 1128px，**只差 16px（1.4%）**，肉眼看不出來。
   而且不論 4K 或 720p 都被同一個數字夾死，`autoByQuality` 與 `fitWindow` 產生的 CSS 一模一樣，
   模式選單形同虛設。改為「播放器先取空間、側欄撿剩下的、擠不下就換行」後，同一情境變成 **1392×783（+25%）**，
   垂直空白從 228px 降到 80px。
2. **`#columns` 的 min-width 由 YouTube 依播放器寬度反推** — 播放器一放大就長出橫向捲軸
   （實測 min-width 被算成 1760px），而且 min-width 撐著，flex 容器永遠不覺得空間不足、側欄也就永遠不換行。已強制歸零。
3. **彈出視窗認不出自己** — 標記放在 URL hash，但 YouTube 的 SPA 會 `replaceState` 清掉它，
   與 content script 在 `document_idle` 執行是競態，慢一步就套用一般版面。
   改由 service worker 記住自己開的分頁 id（存 `storage.session`，撐過 SW 閒置回收）來回答。
4. **ABR 抖動造成尺寸連跳** — 放大後才看得出來：YouTube 開播時畫質由低往上爬，播放器會跟著跳好幾次。
   現在升畫質立即跟進、降畫質需持續 4 秒才縮。
5. 其他：`#bottom-row` 的 -6px 負邊界在零留白模式下露出 12px 溢出（已就地夾住）；
   側欄換行後播放器置中；不再相依 `[is-two-columns_]` 這個 Polymer 私有屬性；
   單元測試 28 → 32、端到端 20 → 26。

---

## [2.1.0] — 2026-08-02

本版修掉 v2.0 三個「功能整塊失效」的問題：

1. **設定面板完全無效** — popup 寫 `chrome.storage.local` 的扁平鍵，content script 讀
   `chrome.storage.sync` 的 `yt_auto_resizer_settings`，兩邊從未對上。現統一為單一 schema，並提供舊設定一次性遷移。
2. **沒有 service worker** — content script 送出的 `GET_SETTINGS` / `RESIZE_WINDOW` /
   `OPEN_POPUP_PLAYER` 三種訊息都沒有接收端，彈出式播放器按鈕點了沒反應。已補上 `background.js`。
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

[3.0.0]: https://github.com/boboidvtw/youtube-auto-resizer-extension/releases/tag/v3.0.0
[2.3.0]: https://github.com/boboidvtw/youtube-auto-resizer-extension/releases/tag/v2.3.0
[2.2.0]: https://github.com/boboidvtw/youtube-auto-resizer-extension/releases/tag/v2.2.0
[2.1.0]: https://github.com/boboidvtw/youtube-auto-resizer-extension/releases/tag/v2.1.0
