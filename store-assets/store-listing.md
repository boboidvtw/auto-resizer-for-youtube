# Chrome Web Store 上架填表對照表

> ## ✅ v3.0.0 已於 2026-08-05 通過審核並發布（公開）
>
> **商店網址**：<https://chromewebstore.google.com/detail/auto-resizer-for-youtube/kbeeadfnblmodcbjhijdkoebfejkncgd>
> **商店版擴充功能 ID**：`kbeeadfnblmodcbjhijdkoebfejkncgd`（由 Google 指派，與未封裝安裝的路徑推導 ID 無關）
>
> ⚠️ **待修**：商店頁的 **Support URL** 仍是改名前的
> `https://github.com/boboidvtw/youtube-auto-resizer-extension/issues`。
> 那是送審前填的，repo 改名後沒回頭改 Dashboard。GitHub 會重導所以不會斷，
> 但欄位裡還帶著以商標開頭的舊名，下次進 Dashboard 時順手改成
> `https://github.com/boboidvtw/auto-resizer-for-youtube/issues`。
>
> 本檔以下內容保留為**改版重傳時的填表依據**。

> 對應 v3.0.0 · 建立 2026-08-05
> 所有欄位的值都取自本 repo 的實際檔案（`manifest.json` / `_locales/` / `PRIVACY.md`），
> 改動那些檔案後記得回來同步這一份。
>
> Developer Dashboard: <https://chrome.google.com/webstore/devconsole>
> 首次上架需一次性 $5 USD 開發者註冊費。

---

## 0. 上傳的檔案

| 項目 | 值 |
|---|---|
| 套件 | `dist/auto-resizer-for-youtube-v3.0.0.zip`（跑 `bash tools/package.sh` 產生） |
| 版本 | `3.0.0`（來自 manifest，商店會自己讀，不用手填） |

**注意**：同一個版本號只能上傳一次。被退件後修正重傳，要先把 `manifest.json` 的
`version` 往上加（例如 `3.0.1`），並在 `CHANGELOG.md` 補一段 —— CI 會檢查兩者對得上。

---

## 1. Store listing（商店資訊）

### 基本欄位

| 欄位 | 填什麼 |
|---|---|
| **Category** | `Productivity`（次選 `Photos & Video`。功能是改善觀看效率，Productivity 較貼近，且該分類審核基調較寬） |
| **Language** | `English (United States)` — 對應 manifest 的 `default_locale: "en"` |
| **Official URL / Homepage** | `https://labs.moneyai168.com/projects/auto-resizer-for-youtube/` |
| **Support URL** | `https://github.com/boboidvtw/auto-resizer-for-youtube/issues` |
| **Mature content** | 否 |
| **Pricing** | Free |
| **Visibility** | Public |
| **Distribution** | All regions |

### Product name（商店會自動從 manifest 讀，通常不用手填）

```
Auto Resizer for YouTube™
```

> 25 字元（上限 75）。**不要改成以 YouTube 開頭的名字** —— 那是 Google 明確的退件理由，
> `tests/i18n.test.js` 也有一條斷言擋著。

### Summary / 簡短說明（上限 132 字元）

**English**（124 字元）

```
Auto-fits the YouTube player to your window, screen and playback quality. 4K and multi-monitor aware, with a pop-out player.
```

**繁體中文**（51 字元）

```
依畫質、視窗與螢幕解析度自動調整 YouTube 播放器尺寸，支援 4K 與多螢幕，另有彈出式播放器。
```

**日本語**（68 字元）

```
再生画質・ウィンドウ・画面解像度に合わせて YouTube プレーヤーを自動リサイズ。4K とマルチモニターに対応、ポップアウト再生も。
```

### Detailed description / 詳細說明（上限 16,000 字元）

**English**

```
YouTube only ever grows its player to the size it wants. On a 1600px window a 4K video still
sits in a 1112px box, with a recommendations rail permanently occupying 400px to its right and
a large empty gap underneath.

This extension flips the order: the player claims space first, the recommendations rail takes
what is left, and it wraps below when it no longer fits.

WHAT IT DOES

• Match the quality — caps at the video's native resolution, then shrinks to the largest 16:9
  size the window can hold. A 4K video on a 1600x863 window goes from 1112px to 1392px wide.

• Display adaptation — works out the quality you actually need from player width multiplied by
  your screen's pixel density, then asks YouTube for it. Drag the window from a Retina laptop
  to a 4K monitor and the quality is recalculated. You can set a ceiling (default 4K).

• Pop-out player — a button in the player controls opens the current video in its own window and
  resumes from the same second. Only the player is kept; the masthead, recommendations, video
  info and comments are all collapsed. The window size is corrected in a closed loop until the
  content area matches the video's aspect ratio, and you can choose which display it opens on.

• Quality lock — pin every new video to a quality you choose (2160p down to 480p). If a video
  does not offer it, the highest available is used instead.

• Zero-gap layout — removes the padding beside and above the player.

PRIVACY

No data collection. No server, no analytics, no remote code, no outbound connections of any
kind — the source contains no fetch or XMLHttpRequest calls at all. Your settings live in the
browser's own storage and sync through your Google account; the developer cannot see them.

Full policy: https://labs.moneyai168.com/projects/auto-resizer-for-youtube/privacy.html

OPEN SOURCE

MIT licensed. Source, tests and issue tracker:
https://github.com/boboidvtw/auto-resizer-for-youtube

---

YouTube™ is a trademark of Google LLC. This extension is an independent project and is not
affiliated with, sponsored by, or endorsed by Google LLC or YouTube.
```

**繁體中文**

```
YouTube 的播放器只會長到它自己想要的大小。1600px 的視窗上，一支 4K 影片仍然被塞在
1112px 的框裡，右邊擺著永遠佔住 400px 的推薦欄，底下是一大片空白。

這個擴充功能把順序反過來：播放器先取空間，推薦欄撿剩下的，擠不下就換行到下方。

功能

• 依畫質自動匹配尺寸 —— 以影片原生解析度為上限，再收斂到視窗容納得下的最大 16:9。
  1600x863 的視窗上，4K 影片從 1112px 變成 1392px 寬。

• 螢幕適配（4K / 多螢幕）—— 依「播放器寬度 × 螢幕像素密度」推算需要的畫質並主動要求。
  把視窗從 Retina 筆電拖到 4K 外接螢幕，畫質會跟著重算。可設定自動畫質上限（預設 4K）。

• 彈出式播放器 —— 控制列上多一顆按鈕，把目前影片以獨立視窗開啟並從當前秒數續播，
  視窗內只保留播放器（頁首、推薦欄、影片資訊、留言皆收起）。尺寸以閉環校正貼合影片
  長寬比，並可指定開在哪一台螢幕。

• 畫質鎖定 —— 每支新影片自動鎖到你指定的畫質（2160p ~ 480p）；影片沒有此畫質時
  取可用的最高畫質。

• 零留白版面 —— 消除播放器兩側與上方的留白。

隱私

不收集任何資料。沒有伺服器、沒有分析工具、沒有遠端程式碼、沒有任何對外連線 ——
整份原始碼裡連一個 fetch 都沒有。你的設定存在瀏覽器自己的儲存空間，經由你的 Google
帳號同步，開發者看不到。

完整政策：https://labs.moneyai168.com/projects/auto-resizer-for-youtube/privacy.html

開放原始碼

MIT 授權。原始碼、測試與問題回報：
https://github.com/boboidvtw/auto-resizer-for-youtube

---

YouTube™ 是 Google LLC 的商標。本擴充功能由個人獨立開發，與 Google LLC 或 YouTube
沒有任何從屬、贊助或背書關係。
```

**日本語**

```
YouTube のプレーヤーは、YouTube が決めた大きさまでしか広がりません。1600px のウィンドウでも
4K 動画は 1112px の枠に収まったまま、右側は関連動画が 400px を占有し、下には大きな余白が残ります。

この拡張機能は順序を逆にします。プレーヤーが先に場所を取り、関連動画は残りを使い、
収まらなくなれば下へ折り返します。

主な機能

• 画質に合わせたサイズ調整 —— 動画本来の解像度を上限に、ウィンドウに収まる最大の 16:9 まで
  縮めます。1600x863 のウィンドウでは 1112px から 1392px へ。

• 画面への適応（4K / マルチモニター）—— 「プレーヤーの幅 × 画素密度」から必要な画質を求め、
  YouTube に要求します。Retina のノート PC から 4K モニターへウィンドウを移すと画質を再計算。
  上限も設定できます（既定は 4K）。

• ポップアウト再生 —— 再生バーのボタンで、現在の動画を同じ再生位置のまま別ウィンドウで開きます。
  プレーヤーだけを残し、ヘッダー・関連動画・動画情報・コメントは折りたたみます。
  ウィンドウの大きさは動画の縦横比に合うまで自動補正され、開く画面も指定できます。

• 画質の固定 —— 新しい動画を常に指定の画質（2160p〜480p）で再生します。
  その画質がない場合は、利用できる最高画質を選びます。

• 余白のないレイアウト —— プレーヤーの両脇と上の余白を詰めます。

プライバシー

データを一切収集しません。サーバーも、解析ツールも、リモートコードも、外部への通信もありません
—— ソースコードには fetch すら含まれていません。設定はブラウザ自身のストレージに保存され、
Google アカウント経由で同期されます。開発者が見ることはできません。

プライバシーポリシー：
https://labs.moneyai168.com/projects/auto-resizer-for-youtube/privacy.html

オープンソース

MIT ライセンス。ソースコード・テスト・不具合報告：
https://github.com/boboidvtw/auto-resizer-for-youtube

---

YouTube™ は Google LLC の商標です。本拡張機能は個人による独立したプロジェクトであり、
Google LLC および YouTube とは提携・後援・推奨のいずれの関係もありません。
```

### 圖片素材

| 欄位 | 檔案 | 規格 |
|---|---|---|
| Store icon | `store-assets/store-icon-128.png` | 128×128 ✓（圖形佔中央 96×96，四周留 16px 透明邊——商店規格與 manifest 的 `icons/icon.png` 不同，後者是滿版，不可拿來當商店圖示） |
| Screenshot 1 | `store-assets/01-watch-page.png` | 1280×800 ✓ |
| Screenshot 2 | `store-assets/02-settings-panel.png` | 1280×800 ✓ |
| Small promo tile | `store-assets/promo-small-440x280.png` | 440×280 ✓ |
| Marquee promo tile | 未製作 | 1400×560（選填，只有被 Google 選為精選時才用得到） |

重新產生：`bash tools/store-screenshots.sh`（截圖）、
`bash tools/build-promo.sh`（宣傳圖 + 商店圖示，皆由向量來源產生並自我檢查幾何）。

---

## 2. Privacy（隱私權）分頁 — 最容易卡關的一頁

### Single purpose description（單一用途說明）

```
This extension has a single purpose: adjusting how the YouTube video player is sized and what
playback quality it uses, so the video fills the space available on the user's screen.

Every feature serves that one purpose — resizing the player to the window, choosing a playback
quality appropriate to the display's pixel density, removing the gaps around the player, and
opening the video in a dedicated pop-out window sized to the video's aspect ratio.

The extension runs only on YouTube watch pages and does nothing on any other site.
```

> 政策依據：單一用途允許「限定在一個狹窄主題領域內的多種功能」。
> 本擴充功能的所有功能都落在「YouTube 播放器的尺寸與畫質」這一個領域內。

### Permission justification（每個權限都要寫，缺一不可）

**`storage`**

```
Stores the user's own settings — preferred playback quality, sizing mode, quality ceiling, and
which display the pop-out player should open on — and syncs them across the user's own devices
through chrome.storage.sync. No other data is stored, and the developer has no access to it.
```

**`system.display`**

```
Reads the resolution and work area of the user's displays in order to (1) work out the playback
quality the screen actually warrants, based on player width multiplied by pixel density, and
(2) size and position the pop-out player window on the correct monitor.

This is read-only via chrome.system.display.getInfo(). The extension never changes any display
setting, and this API cannot read or capture screen contents.

It is required because the page itself cannot be trusted for this: browsers with fingerprinting
protection report altered screen dimensions to web pages (measured on the same machine at the
same moment: the page saw 1680x1050 while the real displays were 1710x1107 and 3840x2160).
Sizing a window for a 4K monitor from the altered numbers produces a window half the correct size.
```

**Host permission `https://www.youtube.com/*`**

```
The extension only works on YouTube watch pages. On those pages it needs to inject CSS to resize
the player, read the current playback quality and video dimensions from the page's own player API,
and add a pop-out button to the player controls.

No other host is requested, and the extension does nothing on any other site.
```

### Remote code

```
No — 選「No, I am not using remote code」
```

所有程式碼都包含在套件內。無 `eval`、無外部 script 標籤、無 CDN。

### Data usage（資料使用聲明）

**全部不勾。** 逐項確認皆為「不收集」：

| 資料類型 | 是否收集 |
|---|---|
| Personally identifiable information | ✗ |
| Health information | ✗ |
| Financial and payment information | ✗ |
| Authentication information | ✗ |
| Personal communications | ✗ |
| Location | ✗ |
| Web history | ✗ |
| User activity | ✗ |
| Website content | ✗ |

### 三個必勾的認證（Certifications）

全部勾選，三項皆屬實：

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

```
https://labs.moneyai168.com/projects/auto-resizer-for-youtube/privacy.html
```

---

## 3. 送審前的最後檢查

```bash
# 全部應為綠
node --test tests/*.test.js          # 70 條
bash tests/run-e2e.sh                # 36 條（需要 Brave）
bash tools/package.sh                # 產生 zip 並自我檢查內容乾淨
```

- [ ] zip 內沒有 `tests/` `tools/` `store-assets/` `memory/` `.github/`（`package.sh` 會自己檢查）
- [ ] 隱私權網址在無痕視窗打得開
- [ ] 三張圖片尺寸正確（CI 有守門）
- [ ] 名稱沒有以 YouTube 開頭

---

## 4. 上架通過之後

- [ ] 把商店連結補進 `README.md`、Bobo Labs 專案頁與首頁 project card（三處現在寫的是「審核中」）
- [ ] 在 `CHANGELOG.md` 記一筆上架日期
