# 隱私權政策 / Privacy Policy

**最後更新 / Last updated: 2026-08-05**

託管版本（Chrome Web Store 填寫的網址）:
<https://labs.moneyai168.com/projects/auto-resizer-for-youtube/privacy.html>

---

## 繁體中文

Auto Resizer for YouTube™（以下稱「本擴充功能」）**不收集、不儲存、不傳輸、不分享、也不販售任何使用者的個人資料**。

### 一、本擴充功能不收集任何資料

本擴充功能沒有伺服器，也不會對任何伺服器發出請求。具體而言，它**不會**：

- 收集或傳送個人識別資訊（姓名、電子郵件、地址、身分證號等）
- 收集健康資訊、財務資訊或付款資訊
- 收集驗證資訊（密碼、憑證、Cookie、存取權杖）
- 收集你的個人通訊內容（郵件、訊息）
- 收集位置資訊
- 記錄你的瀏覽紀錄、搜尋紀錄或看過哪些影片
- 記錄滑鼠點擊、按鍵輸入等使用者活動
- 植入任何分析、統計或廣告追蹤程式碼
- 載入任何遠端程式碼（所有程式碼都包含在擴充功能套件內）

這一點可以自行查證 —— 在本 repo 搜尋 `fetch`、`XMLHttpRequest` 或任何網址，不會找到對外的連線：

```bash
grep -rniE "fetch\(|XMLHttpRequest|https?://" --include="*.js" --include="*.html" . | grep -v "^./tests"
```

唯一的兩筆命中是 `https://www.youtube.com/watch?v=...`（開啟彈出式播放器用的網址）
與設定面板底部指向 PayPal 的贊助連結。

### 二、本擴充功能儲存了什麼

只有你自己的設定 —— 畫質、縮放模式、彈出播放器要開在哪一台螢幕等。這些存放在瀏覽器提供的
`chrome.storage.sync`，由你的瀏覽器經 Google 帳號在你自己的裝置之間同步。
**開發者無法存取這些資料**，它們從未離開 Google 與你的裝置。移除擴充功能時會一併刪除。

### 三、權限用途

| 權限 | 用途 |
|---|---|
| `storage` | 儲存你在設定面板中的選擇，並讓設定在你的裝置之間同步。 |
| `system.display` | 讀取螢幕解析度與工作區範圍，用來決定播放器該多大、彈出視窗開在哪一台螢幕。只讀取，不修改任何顯示設定；**不會讀取螢幕內容，也無法截圖**。 |
| `https://www.youtube.com/*` | 本擴充功能只在 YouTube 觀看頁面運作，用來套用版面樣式、讀取目前播放畫質，並在控制列加上彈出播放器按鈕。除 YouTube 外的網站一律不會被存取。 |

### 四、第三方

不使用任何第三方服務、SDK、分析工具或廣告聯播網，也不會與任何第三方分享資料 —— 因為根本沒有資料可以分享。

設定面板底部的 PayPal 贊助連結是一般的外部連結，點擊後才會離開瀏覽器前往該網站，
並適用該網站自己的隱私權政策。不點就不會有任何連線發生。

### 五、兒童隱私

本擴充功能不針對兒童設計，也不會有意或無意收集任何年齡層使用者的資料。

### 六、政策變更

本政策若有變更，會更新本檔最上方的日期並記錄於 [CHANGELOG.md](CHANGELOG.md)。歷史修改可於 Git 紀錄查得。

### 七、聯絡方式

<boboidvtw+labs@gmail.com> 或
[GitHub Issues](https://github.com/boboidvtw/youtube-auto-resizer-extension/issues)。

---

## English

**Auto Resizer for YouTube™ collects no user data whatsoever.** It has no server and makes no
network requests of any kind.

### 1. No data collection

The extension does **not** collect or transmit personally identifiable information, health or
financial information, authentication information, personal communications, location, browsing or
search history, or user activity. It contains no analytics, no advertising trackers, and no
remotely hosted code. This is verifiable — the source is public and contains no outbound `fetch`
or `XMLHttpRequest` calls.

### 2. What is stored

Only your own settings (preferred quality, sizing mode, which display the pop-out player opens on).
These live in the browser's own `chrome.storage.sync` and sync between your devices through your
Google account. The developer cannot access them. Removing the extension deletes them.

### 3. Permission justification

| Permission | Why it is needed |
|---|---|
| `storage` | Saves your settings and syncs them across your own devices. |
| `system.display` | Reads screen resolution and work area to size the player and place the pop-out window. Read-only; it cannot capture or read screen contents. |
| `https://www.youtube.com/*` | The extension runs only on YouTube watch pages, where it applies layout CSS, reads the current playback quality, and adds a pop-out button to the player controls. No other site is ever accessed. |

### 4. Third parties

No third-party services, SDKs, or analytics are used, and no data is shared with anyone — there is
none to share. The settings panel contains one ordinary outbound link to PayPal; no request
is made unless you click it.

### 5. Children's privacy

The extension is not directed at children and collects no data from users of any age.

### 6. Changes

Changes update the date at the top of this file and are recorded in [CHANGELOG.md](CHANGELOG.md).

### 7. Contact

<boboidvtw+labs@gmail.com> or
[GitHub Issues](https://github.com/boboidvtw/youtube-auto-resizer-extension/issues).

---

YouTube™ is a trademark of Google LLC. This extension is an independent project and is not
affiliated with, sponsored by, or endorsed by Google LLC or YouTube.
