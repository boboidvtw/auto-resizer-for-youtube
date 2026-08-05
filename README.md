# Auto Resizer for YouTube™

> 依畫質、視窗大小與**螢幕解析度**自動調整 YouTube 播放器尺寸，零留白、不溢出、可鎖定畫質，支援 4K 與多螢幕。
> Resize the YouTube player to fit your window, quality and **display**, lock playback quality, and pop the video out
> onto the screen you choose — 4K and multi-monitor aware, Manifest V3.

[![CI](https://github.com/boboidvtw/youtube-auto-resizer-extension/actions/workflows/test.yml/badge.svg)](https://github.com/boboidvtw/youtube-auto-resizer-extension/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![i18n](https://img.shields.io/badge/i18n-en%20%7C%20zh__TW%20%7C%20ja-blue.svg)](_locales)

**專案首頁**：<https://labs.moneyai168.com/projects/auto-resizer-for-youtube/> ·
**隱私權政策**：[PRIVACY.md](PRIVACY.md) ·
**版本紀錄**：[CHANGELOG.md](CHANGELOG.md)

---

## 📖 功能 (Features)

### 四種尺寸模式 (Four resize modes)

| 模式 Mode | 行為 Behaviour | 1600×863 視窗實測 |
|---|---|---|
| **依畫質自動匹配** `autoByQuality` | 以影片原生解析度為寬度上限（4K → 3840px），再由視窗寬高夾擠到可容納的最大 16:9 尺寸 | 4K 影片 **1392×783**；240p 影片 426×240（不放大糊圖） |
| **強制視窗貼合** `fitWindow` | 忽略畫質，一律撐滿視窗可用空間 | 一律 **1392×783** |
| **強制劇院模式** `theater` | 播放器滿寬，推薦影片欄移到下方 | 1392×783 |
| **預設** `default` | 完全不介入，維持 YouTube 原生版面 | 1112×626 |

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
- 🌐 **三語介面**：English / 繁體中文 / 日本語，跟隨瀏覽器語系。

---

## 🔒 隱私 (Privacy)

**不收集任何資料。** 沒有伺服器、沒有分析工具、沒有遠端程式碼、沒有任何對外連線。
設定存在瀏覽器自己的 `chrome.storage.sync`，開發者看不到。

可自行查證：

```bash
grep -rniE "fetch\(|XMLHttpRequest|https?://" --include="*.js" --include="*.html" . | grep -v "^./tests"
```

唯一的命中是彈出播放器要開的 `youtube.com/watch` 網址，與設定面板底部的贊助連結。
完整說明見 [PRIVACY.md](PRIVACY.md)。

---

## 🚀 安裝 (Installation)

Chrome 線上應用程式商店審核中。目前請以開發者模式載入：

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
├── _locales/          # en / zh_TW / ja 三語字串
├── background.js      # Service worker：設定供應、視窗調整、彈出播放器
├── src/
│   ├── config.js      # 設定結構、版面常數、storage 與 i18n 封裝（三端共用）
│   ├── display.js     # 顯示器分級、螢幕選擇、依螢幕的畫質決策（純函式）
│   └── layout.js      # 播放器 CSS 產生器（純函式）
├── content.js         # 隔離世界主控：套用樣式、注入主世界腳本、控制列按鈕
├── injected.js        # 主世界：畫質／解析度偵測，回報給隔離世界
├── pageScript.js      # 主世界：透過原生 player API 設定畫質
├── popup.html/js/css  # 設定面板
├── tests/             # 零相依測試（node:test + node:vm）
├── tools/             # 商店素材產生器（真實載入擴充功能後截圖）
├── store-assets/      # 1280×800 商店截圖
└── icons/
    ├── icon.svg       # 單一向量來源
    └── build.sh       # 產生 16/32/48/128 PNG（需 rsvg-convert）
```

**世界分工**：`injected.js` 只偵測、`pageScript.js` 只控制、`content.js` 只套版面。
主世界對同一支影片只廣播一次狀態，隔離世界可透過 `YT_AUTO_RESIZER_REQUEST_STATE` 事件要求重播。

**圖示**：改 `icons/icon.svg` 後跑 `bash icons/build.sh` 重新產生四個 PNG，四種尺寸因此不可能彼此漂移。

**打包上架**：`bash tools/package.sh` 產生 `dist/auto-resizer-for-youtube-v<版本>.zip`。
該腳本裡的 `SHIP` 清單是「什麼算是擴充功能本體」的單一真相來源，CI 也用同一份清單
決定隱私掃描的範圍。手動 zip 整個資料夾會把 `tests/`、`tools/`、`memory/` 一起送去給審核員看。

**商店素材**：`bash tools/store-screenshots.sh` 會啟動一個載入本擴充功能的 Brave 實例，
對真實 YouTube 截出 1280×800 的商店截圖。截圖前會先斷言樣式確實套用、影片確實在播放 ——
少了這一關，樣式沒生效時產出的會是一組「YouTube 原生版面」的截圖，看起來很正常，
但宣傳的是我們沒做到的事。

**宣傳圖**：`bash tools/build-promo.sh` 由 `store-assets/promo-small.svg` 產生商店的
440×280 small promo tile。三種素材的尺寸都有 CI 守門 —— 商店對尺寸零容忍，
而錯誤尺寸從檔案總管看不出來。

---

## 🧪 測試 (Tests)

**單元測試**（零相依，Node 內建 test runner + `vm`）：

```bash
node --test tests/*.test.js
```

70 條，涵蓋設定正規化、版面 CSS 產生器、視窗尺寸計算、service worker 的 URL 驗證，
以及 `_locales` 的翻譯一致性（key 集合、placeholder、商店長度上限、孤兒 key）。

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

## 📝 版本紀錄 (Changelog)

見 [CHANGELOG.md](CHANGELOG.md)。最新版 **v3.0.0**（2026-08-05）是上架前的合規整備：
改名、自製圖示、修復被改壞的 MIT 授權條款、三語在地化、隱私權政策。

---

## ☕ 贊助 (Sponsor)

如果這東西對你有用，可以[請我喝杯咖啡](https://buymeacoffee.com/boboidvtw)。

## 📄 授權 (License)

[MIT License](LICENSE) © 2026 boboidvtw

---

<sub>
YouTube™ 是 Google LLC 的商標。本擴充功能由個人獨立開發，與 Google LLC 或 YouTube
沒有任何從屬、贊助或背書關係。<br />
YouTube™ is a trademark of Google LLC. This extension is an independent project and is not
affiliated with, sponsored by, or endorsed by Google LLC or YouTube.
</sub>
