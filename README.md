# 🎬 YouTube Auto Resizer & Quality Controller v2.1

> 自動調整 YouTube 播放器尺寸與畫質選單鎖定，完美相容 4K (2160p) / 2K (1440p) / 1080p，零留白貼合視窗。

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://www.paypal.me/boboidvtw)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg?style=for-the-badge)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

---

## 📖 關於本專案 (About)

**YouTube Auto Resizer & Quality Controller** 是一款專為提升 YouTube 觀賞體驗而打造的 Chrome / Brave 瀏覽器擴充功能 (Manifest V3)。

### ✨ 核心亮點功能
- ⚡ **依畫質自動匹配尺寸 (Auto-Resize by Quality)**：
  - **4K (2160p) / 2K (1440p)**：自動展開為 **滿版視窗貼合 (Fit-Window)**，無黑邊、零重疊。
  - **1080p (Full HD)**：自動切換為 **標準劇院模式 (Theater Mode)**。
  - **720p 及以下 (SD)**：自動維持 **原生預設尺寸**，防止低畫質影片失真。
- 🎯 **原生 Context Player API 鎖定**：自動帶入優先最高畫質（4K 2160p / 2K 1440p / 1080p）。
- 🎨 **零留白 (Zero-Gap) 與防重疊 (No-Overlap) 設計**：智慧算術計算 16:9 比例上限 (`min(calc(100vh - 56px), 56.25vw)`)，徹底消除頂部灰塊與標題資訊欄覆蓋問題。
- 🎛️ **現代感暗色調 Popup UI**：簡潔美觀的控制面板與自訂切換模式。

---

## 🚀 安裝與使用 (Installation)

1. 下載或 Clone 本專案：
   ```bash
   git clone https://github.com/boboidvtw/youtube-auto-resizer-v2.git
   ```
2. 開啟 Chrome / Brave 瀏覽器，前往 `chrome://extensions` 頁面。
3. 開啟右上角 **「開發者模式 (Developer mode)」**。
4. 點擊 **「載入未壓縮擴充功能 (Load unpacked)」**，並選擇本專案資料夾。
5. 開啟任何 YouTube 影片即可享受智慧畫質與滿版貼合體驗！

---

## 📁 檔案結構 (Architecture)

```
youtube-auto-resizer-v2/
├── manifest.json         # Manifest V3 設定檔
├── popup.html            # 現代感暗色調控制面板 UI
├── popup.css             # UI 樣式
├── popup.js              # 控制面板設定同步
├── content.js            # YouTube DOM 監聽與智慧 16:9 邊界補丁
├── pageScript.js         # YouTube 原生 Context Player API 控制器
└── icons/                # 專案圖示
```

---

## ❤️ 贊助與支持 (Sponsor & Support)

如果您喜歡這個專案並希望支持未來的維護與開發，歡迎點擊下方連結進行贊助支持！❤️

[![Donate with PayPal](https://img.shields.io/badge/Donate-PayPal-blue.svg?style=for-the-badge&logo=paypal)](https://www.paypal.me/boboidvtw)

---

## 📄 授權條款 (License)

[MIT License](LICENSE) © 2026 boboidvtw
