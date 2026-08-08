# Project Context & Handoff Log - Auto Resizer for YouTube™

> Last Closed: 2026-08-08（**v3.0.1 已上架**，改名遺留的舊網址全部清除；見下方「2026-08-08」段落）
> 前一版：2026-08-07（**Next Session Goals 的 4 項全部處理完畢**；見下方「2026-08-07」段落）
> 前一版：2026-08-06T17:52:36+08:00 (**v3.0.0 已上架 Chrome Web Store**；
> 商店圖示產生腳本 + 留白守門；repo 與本機資料夾改名為 `auto-resizer-for-youtube`)
> 前一版：2026-08-05T14:56:07+08:00 (v3.0.0 收尾 — 商店素材補齊，程式碼零變更)
> 更前一版：2026-08-05 (v3.0.0 — Chrome Web Store 上架前合規整備, commit ad6e4f8)
> 更前一版：2026-08-04T20:54:25+08:00 (v2.3.0, code commit b7c4eb2 — 4K / 多螢幕適配；
> 跨螢幕拖曳實測於 d3b4686 補記)

**本次收工的實際狀態**：沒有新的程式修改。工作區只剩一個未追蹤的商店素材
`store-assets/store-icon-128.png`（128×128、圖形佔中央 96×96、四周 16px 透明邊），
已補進版控並在 `store-assets/store-listing.md` 的素材表登記。
單元 + i18n 測試 **70/70 綠**（`node --test tests/unit.test.js tests/i18n.test.js`）；
e2e 本次未重跑（需要 Brave + 真實 YouTube，程式碼未動故沿用 v3.0.0 的結果）。

## 🚀 2026-08-08 — v3.0.1 已上架，改名遺留的舊網址全部清除

線上實測（公開商店頁，非 Dashboard）：`Version` = **3.0.1**、`Updated` = August 8, 2026、
舊網址 `youtube-auto-resizer-extension` 殘留 **0 次**、新網址 2 次。

| 欄位 | 結果 |
|---|---|
| 套件版本 | ✅ 3.0.1 |
| Support URL | ✅ 2026-08-06 提交 → 08-07 過審 |
| 說明文案的 OPEN SOURCE 段落 | ✅ 隨 v3.0.1 一併更新 |

### 這次真正值得記的：兩個欄位、兩種失效方式

1. **Support URL** —— 有提交、但商店資訊修改也要過審，08-07 才生效。
   「Dashboard 顯示已改」不等於線上已改。
2. **說明文案裡的網址** —— **從 v3.0.0 上架起就是舊的，而且從未提交過修改**。
   `store-assets/store-listing.md` 在 v3.0.0 **送審之後**才更新成新網址，Dashboard 沒回填。
   於是**版控裡的副本是對的、線上的是舊的**，掃 repo 永遠查不出來。

⚠️ **最容易誤判的一步**：驗證指令回的次數從 3 → 2 看起來像「快好了」，
實際上那是**兩個不同欄位各自的狀態**。是把 HTML 抓下來逐一看命中位置才發現有第二個欄位的。
**看命中「位置」，不要只看命中「次數」。**

推論：凡是商店後台的欄位（版控外的一份副本），一律以公開商店頁為準去驗，
而且要驗到具體位置。同課題見 `feedback_verify_browser_not_curl_status`。

### 上架後的維運

- 監看 Dashboard 的評分／使用者數。
- YouTube Polymer 版面若改動（`theater` / `full-bleed-player` 屬性名、`#columns` 的
  min-width 算法）會讓版面邏輯失效。
- 下次改版流程不變：改 `manifest.json` 版號 → 補 `CHANGELOG.md` 段落（CI 會擋不一致）→
  `bash tools/package.sh` → 上傳新 zip。**同一版號只能上傳一次。**

---

## 🧹 2026-08-07 — 清掉 Next Session Goals 的四項待辦

單元測試 74 → **97 全綠**；e2e 內建 **40/40**、4K **46/46**。`tools/package.sh` 乾淨。

### ① content.js 662 → 581 行（抽出兩個純函式模組）

- `src/quality-policy.js` — 螢幕感知決策（螢幕容量、該要什麼畫質、能不能放大、升降畫質判準）
- `src/window-fit.js` — 視窗尺寸請求與彈出視窗閉環校正的幾何核心

分工原則：**算得出答案的東西住在 `src/`，只能靠開瀏覽器驗的東西才留在 `content.js`**。
抽出後那些不變量（「受限後只能送寬度」「升畫質立即、降畫質等 settle」）第一次有了單元測試。

順帶修掉一個同類缺陷：`content.js` 的 `qualityWidth()` 用 `YAR_QUALITY_WIDTH[q] || 0`，而畫質代碼
來自主世界的 YouTube player（頁面可控）。v2.3.0 在 `yarShouldUpscale` 修過一模一樣的問題。
現在集中成 `src/config.js` 的 `yarQualityWidthOf()` 單一入口。

新增兩條守門（**都做過反向驗證**）：
- `src/` 底下每支檔案都必須有載入端（manifest 或 importScripts）。`package.sh` 打包的是整個
  `src/` 目錄，漏註冊的檔案照樣進 zip、CI 照樣全綠，只有真的呼叫到才炸 ReferenceError。
- `content.js` / `background.js` / `popup.js` 行數上限 800。

### ② e2e 螢幕座標改為執行期偵測（`tests/pick-screen.js`）

拿掉寫死的 `1710,40`，改問 service worker 的 `chrome.system.display` 真值，再用
`chrome.windows.update` 定位。要求的螢幕不存在就中止（`SCREEN=uhd` 會驗到邏輯寬 >= 3840，
單螢幕環境下不會靜默退回內建螢幕跑 4K 門檻）。

### 🚨 ②的副產品：舊 e2e 有一條檢查一直在測命令列旗標

`--window-position` / `--window-size` **會覆蓋之後每一個 `chrome.windows.create` 的座標**，
而且沒有任何錯誤。實測同一支探測腳本：

| 啟動旗標 | `chrome.windows.create` 要求 | 實得 |
|---|---|---|
| 有 `--window-size/position` | `{left:1762, top:30, 3737x2130}` | `{left:0, top:40, 1280x800}` |
| 無 | 同上 | `{left:1762, top:30, 3737x2130}` |

後果不是紅燈而是**綠燈但什麼都沒守到**：舊版把主視窗開在 `1710,40`，彈出視窗也被同一個旗標
放到 `1710,40`，於是「彈出視窗開在來源視窗所在的螢幕 (follow)」必然成立。
擴充功能的定位邏輯**從來沒有被真的驗證過**（修正後首次真跑：彈出視窗 `3737x2130@1762,30`）。

已把旗標拿掉，並在 `pick-screen.js` 加一條 harness 自檢：每次跑之前實開一個已知座標的視窗
回查，不照給就中止。**與其在註解裡叮嚀「不要加那兩個旗標」，不如每次實測一次。**

### ③ 側欄並排被拉寬 —— 已被 v2.3.0 修掉，現在有守門

補了一條內建螢幕跑得到的檢查（釘 240p + 關螢幕感知，含情境重現前置斷言）。
實測 player=426 / viewport=1670 剩餘 1244px 之下，**側欄 = 400px**，沒有被 flex-grow 吃掉。
v2.3.0 的 `#columns` max-width 已經解決了 240p 情境，只是當時沒有內建螢幕跑得到的檢查
（4K 那條需要 3840px 的視窗）。

順手修掉一個判斷式：原本用「側欄寬度接近播放器寬度」推論換行，但播放器縮到 426px 時
一個正常的 400px 側欄就滿足那個條件 → 誤判成「已換行」而放行。改用**位置**（`sameRow`）。

### ④ 非 16:9 影片 —— 實測後發現我們讓直式影片變**小**了，已修

真機實測（Brave，內建螢幕 1670x896，一支 720x1280 的直式影片，畫質釘 720p）：

| 模式 | 播放器容器 | **可見影像** |
|---|---|---|
| `default`（不介入） | 1038x780 | **439x780** |
| `autoByQuality`（修正前） | 1280x720 | **405x720**（面積 −14.8%） |

**本檔原本寫的「直式影片會有大片上下黑邊（同 YouTube 原生行為）」是錯的。**
YouTube 原生會給直式影片一個高的容器；是我們的 `--yar-player-h: calc(w * 9 / 16)` 把它壓成
16:9，逼出左右黑邊，而且比不裝擴充功能還小。

修法：`yarLayoutAspectRatio()` 讓容器高度與寬度上限都跟著 `video.videoWidth/videoHeight`。
**16:9 的輸出必須逐字相同**（含 `* 16 / 9` 的字面寫法），有專門的測試守著 ——
絕大多數影片是 16:9，為了少數 Shorts 而讓全部影片的版面跟著變是不划算的交換。

另外修 `yarNativeWidthFor()`：**YouTube 的畫質標籤指的一律是短邊**，而 `YAR_QUALITY_WIDTH`
記的是 16:9 之下的寬（1080p → 1920）。兩個方向都會錯，而且錯的方向相反：

| 影片 | 舊算法的原生寬 | 正確值 | 後果 |
|---|---|---|---|
| 直式 720x1280 | 1280 | 720 | 允許 2 倍上採樣 |
| 超寬 2520x1080（21:9） | 1920 | 2520 | 播放器被白白鎖小 |

⚠️ 我第一版只改了直式那半邊（`longSide × ratio`），只在**剛好 9:16** 時碰巧正確，
3:4 直式會算出 641 而不是 480 —— 而且我把那個錯誤的期望值寫進了測試裡。
是 code review 抓出來的。正解是先還原短邊（`寬 × 9/16`）再依方向乘回去。
**教訓：拿一個特例驗證出來的公式，很容易連測試一起錯。**

### 待辦（本輪未做）

- [ ] **`yarDisplayCeilingWidth()` 估算螢幕容量時仍固定用 16:9**，即使版面本身已經跟著長寬比走。
      這是刻意的，不是漏接：只把長寬比接進去會讓直式影片**要到更低的畫質**——下游的
      `yarQualityForPlayer()` 比對的是 `YAR_QUALITY_WIDTH`（16:9 的寬度表），而直式影片的
      「720p」只有 720 寬。實測一支 720x1280：播放器 459 CSS × DPR 2 = 918 實體像素，
      容量若估成 459 就會挑到 hd720（720 寬），餵不滿。
      要真的修正，`yarQualityForPlayer()` 必須一起變成長寬比感知。
      現況的方向是「寧可多要一點畫質」，不會讓畫面變糊，所以不急。

⚠️ **未解：YouTube 會逐 session 決定 Shorts 要送 9:16 還是塞進 16:9 的 padded 串流。**
同一支影片、同樣的設定，有時 `hd720 = 720x1280`，有時 `1280x720`。已排除的因素：
`setPlaybackQuality` vs `setPlaybackQualityRange`（兩者都保住 9:16）、冷啟 vs 先開首頁再導航
（`tests/goto.js` 導航當下量到 1080x1920，走完 e2e 前段後變 1280x720）。
觸發條件沒有在合理成本內隔離出來。

因此 e2e 的直式區塊（`EXPECT_PORTRAIT=1` + 直式影片的 `VIDEO=`）會重試三次，
拿不到 9:16 串流就**大聲略過**而不是判紅 —— 把不可控的外部條件做成紅燈，換來的是一條
沒人相信的檢查。**直式版面真正的守門在 `unit.test.js`**（長寬比推導 + 非 16:9 的防漂移測試）。

實測用的直式影片：`OtV7PAtZAyA`（Shorts，`hd720 = 720x1280`）。Shorts 會失效，
要重找可用 `youtube.com/results?search_query=%23shorts` 撈 id 再逐支量 `videoWidth/videoHeight`。
⚠️ 量的時候必須確認 `location.href` 真的是那支影片、且讀 `#movie_player video` ——
搜尋結果頁的內嵌預覽片會讓你量到別支影片（我踩過一次，回報 360x640 實際是 1920x1080）。

### 這一輪學到的

- **「測試綠」與「檢查有作用」是兩件事，而且分辨它們需要主動設計對照。** 這輪有兩條檢查
  被發現是空的：彈出視窗定位（測到命令列旗標）、彈出視窗長寬比（影片沒載入時退回 16:9
  比 16:9）。兩條都通過了好幾個版本。
- **harness 的設定會偽裝成產品行為。** `--window-position` 沒有錯誤、沒有警告，只是安靜地
  讓一條檢查失去意義。凡是「環境條件」，與其寫註解叮嚀，不如在每次執行前實測一次。
- **量測前先確認量的是對的東西。** 導航還沒生效就讀 `document.querySelector('video')`，
  量到的是上一頁的預覽片 —— 量錯對象比量不到危險，因為它會給你一個看起來合理的數字。

---

## 📛 2026-08-05 改名（repo + 本機資料夾）

`youtube-auto-resizer-extension` → **`auto-resizer-for-youtube`**，與 v3.0.0 已改好的
擴充功能名稱、專案首頁路徑、zip 檔名一致。GitHub 會自動重導舊網址。

兩個非顯而易見的後果：

1. **`gh repo rename` 會把 local remote 改寫成 HTTPS**。本專案（以及所有 repo）一律走 SSH，
   改完必須 `git remote set-url origin git@github.com:...` 手動改回來，否則下次 push 會走錯協定。
2. **未封裝擴充功能的 ID 跟著路徑變了**：
   `okbhkhngknadfabcjenigdlidkohpfld` → **`jnjcoahpgokbiggnjpbhpmpjgcfpiacm`**
   （ID = 絕對路徑的 SHA256 前 32 hex，映射 0-9a-f → a-p）。
   對瀏覽器而言這是**另一個擴充功能**：日常 Brave 裡要重新載入，
   舊 ID 底下的 `chrome.storage` 設定不會跟過來。`tests/e2e.js` 是執行時現算，不受影響。

repo 內零寫死絕對路徑（`tests/run-e2e.sh` 用 `BASH_SOURCE`、`tests/e2e.js` 用 `__dirname`），
所以改名沒有動到任何一行程式。改名後在新路徑重跑：測試 74/74 綠、`build-promo.sh` 產出零位元差異。

---

## 🎉 2026-08-05 v3.0.0 已通過審核並發布（公開）

**商店網址**：<https://chromewebstore.google.com/detail/auto-resizer-for-youtube/kbeeadfnblmodcbjhijdkoebfejkncgd>
**商店版 ID**：`kbeeadfnblmodcbjhijdkoebfejkncgd`（Google 指派，與未封裝安裝的路徑推導 ID 是兩回事）

送審當天即通過，沒有退件。已驗證商店頁：名稱 `Auto Resizer for YouTube™`、
自製圖示、截圖、v3.0.0、隱私權政策連結皆正確。

### Support URL 修正（2026-08-06 已提交，待審核）

商店頁的 Support URL 原本仍是改名前的 `.../youtube-auto-resizer-extension/issues`
（送審前填的，repo 改名後沒回頭改 Dashboard）。**2026-08-06 已在 Developer Dashboard
改為 `https://github.com/boboidvtw/auto-resizer-for-youtube/issues`，等待審核。**

⚠️ **商店資訊欄位的修改也要過審才會上線**，不是即時生效 —— 2026-08-06 提交後查公開商店頁，
顯示的仍是舊網址。這是預期行為，不是改失敗。這類 metadata 修改**不需要動版號、不必重傳 zip**。

**過審驗證方式**（開公開商店頁抓，不是看 Dashboard 顯示什麼）：

```bash
curl -s "https://chromewebstore.google.com/detail/auto-resizer-for-youtube/kbeeadfnblmodcbjhijdkoebfejkncgd" \
  | grep -c "youtube-auto-resizer-extension"
```

回 `0` 就是過審生效了。

**這個欄位不在版控裡** —— 商店後台是版控外的一份副本，`grep` 掃不到，只能開實際頁面確認。

#### 2026-08-07 複查：**尚未過審，而且不只一個欄位是舊的**

上面那條 curl 回 **3**（不是 0），新網址回 **0**。逐一看命中的位置，發現是**兩個不同欄位**：

| 欄位 | 現況 | 是否已提交修改 |
|---|---|---|
| Support URL | `.../youtube-auto-resizer-extension/issues` | ✅ 2026-08-06 已提交，**仍待審** |
| **商店說明的「OPEN SOURCE / issue tracker」段落** | `.../youtube-auto-resizer-extension` | ❌ **從來沒改過** |

第二個原本不在追蹤範圍內。`store-assets/store-listing.md` 裡的文案**早就是新網址**（第 123 / 167 行），
但那是 v3.0.0 送審**之後**才更新的，Dashboard 沒有跟著回填 —— 於是版控裡的副本是對的、
線上的是舊的，而 `grep` 只掃得到前者。**這正是「商店後台是版控外的一份副本」的具體代價。**

GitHub 會重導所以不會斷，但欄位裡仍帶著以商標開頭的舊名（那正是 v3.0.0 改名的理由）。
**下次送審時兩個欄位一起改**，說明文案直接照 `store-assets/store-listing.md` 貼。

### 上架後續（維運期）

- 改版流程：改 `manifest.json` 版號 → 補 `CHANGELOG.md` 對應段落（CI 會擋不一致）→
  `bash tools/package.sh` → 上傳新 zip。**同一版號只能上傳一次。**
- 監看：Dashboard 的評分／使用者數；YouTube Polymer 版面若改動（`theater` /
  `full-bleed-player` 屬性名、`#columns` 的 min-width 算法）會讓版面邏輯失效。

---

## 📮 2026-08-05 送審紀錄

`dist/auto-resizer-for-youtube-v3.0.0.zip` 上傳 Chrome Web Store。填表逐欄的對照文字保留在 `store-assets/store-listing.md`
（三語 description、single purpose 說明、每個權限的 justification）——
**被退件後修正重傳時要照著改，並且 `manifest.json` 的 version 必須往上加**
（同一版號只能上傳一次），CI 會檢查 CHANGELOG 有對應段落。

### 改名後的 e2e 複驗（新路徑，2026-08-05）

`bash tests/run-e2e.sh` → **36/36 通過**。關鍵證據是 service worker 的位址：
`chrome-extension://jnjcoahpgokbiggnjpbhpmpjgcfpiacm/background.js` ——
正是新路徑算出來的 ID，證明跑的是改名後的目錄而不是殘留的舊安裝。

| 項目 | 實測 |
|---|---|
| 對照組放大幅度 | 原生 1112x626 → 自動 1392x783（**+25.2%**） |
| 垂直剩餘 | 80px / 863px |
| 橫向溢出 | 無（scrollW 1600 = viewport 1600） |
| i18n | 32 個 `data-i18n` 節點皆有文字，來源確為 `chrome.i18n` |
| 名稱斷言 | `Auto Resizer for YouTube™`，不以 YouTube 開頭 |
| 版本徽章 | v3.0.0 = manifest |
| 彈出視窗 | 黑邊 0x0、長寬比 1.781（基準 1.778）、開在正確螢幕 |
| 螢幕偵測 | 兩台皆可見（內建 1710x1107 + 4K 3840x2160@1710） |

⚠️ README 原本寫「內建螢幕 29 項」是 v2.3.0 的舊數字，v3.0.0 加了 i18n 的 e2e 檢查後
沒回頭更新，已改為 36。

---

## ⚖️ v3.0.0 — 上架合規整備（功能零變更）

全面法律檢視後的整備。**三項原本會直接被 Chrome Web Store 退件**：

1. **名稱以 YouTube 商標開頭**。Google 要求第三方採 `[功能] for [產品]™`。
   實例：*YouTube Tweaks* 2023-09 因商標被下架，改名 `Tweaks for YouTube™` 才復原。
   → 改為 `Auto Resizer for YouTube™`。
2. **圖示與 popup 的 SVG 是 YouTube 官方 logo 的直接複製**（紅底白三角、
   `d="M23.498 6.186..."` 逐字相同）。同時觸犯商標、logo 著作權與 impersonation 政策。
   → 自製對角雙箭頭圖示，單一向量來源 `icons/icon.svg` + `build.sh`。
3. **LICENSE 的 MIT 免責條款被改壞** —— `MECHANICAL FOR A PARTICULAR PURPOSE`
   應為 `MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE`，適售性擔保的排除整段不見。
   **不是理論問題**：`gh repo view --json licenseInfo` 回的是 `{"key":"other"}` 而非 `mit`，
   GitHub 認不出授權，與 README 的 MIT 徽章互相矛盾。→ 貼回標準全文。

另補：三語 i18n（en/zh_TW/ja）、PRIVACY.md + 託管頁、CHANGELOG.md、CI、專案首頁。

### 贊助金流：台灣只剩 PayPal 一條路

一度把 PayPal 換成 Buy Me a Coffee，查證後發現那是**退步**（BMC 完全提領不了，
PayPal 至少海外收得到）。根因是 **Stripe 尚未在台灣開放**：

| 平台 | 台灣可提領 | 依據 |
|---|---|---|
| Buy Me a Coffee | ✗ | 官方 50 國清單無台灣（走 Stripe） |
| GitHub Sponsors | ✗ | 官方 137 個地區清單無台灣 |
| Ko-fi（Stripe） | ✗ | 同樣卡在 Stripe |
| Ko-fi（PayPal） | ✓ | Ko-fi 不持有款項，直接進 PayPal |
| PayPal.me | ✓ | 現行方案 |

**PayPal 的限制要講精確**：被禁的是「台灣付款人 → 台灣收款人」，
台灣收款人收海外款項沒問題。全球市場的產品不受這條限制實質影響。

文案已改為平台中性（「支持贊助 / Support this project」），日後換金流不必動翻譯檔。

### 圖示設計的實測教訓

第一版用「四角 L 形括號 + 中央 16:9 細框」，128px 下好看，**縮到 16px 全部糊成一個藍方塊**。
Chrome 工具列實際顯示的就是 16px —— 256 個像素撐不起四個細元素。
改為三個粗元素（一條對角線 + 兩個實心三角）才在 16px 認得出來。
**圖示一定要看 16px 的實際成像再定案，不能只看 128px。**

### i18n 的守門設計

翻譯漂移**不會讓任何東西壞掉** —— 擴充功能照樣載入、e2e 照樣全綠，只會讓某一格變空白
或停在英文。因此加了兩層：

- `tests/i18n.test.js`（11 條）：各語系 key 集合相同、訊息非空、placeholder 每語系都保留、
  name/description 不超商店上限、名稱不得以 YouTube 開頭、呼叫端用到的 key 都存在、無孤兒 key。
  **寫完立刻做了負向驗證**（故意刪一則 ja 翻譯 + 灌爆長度），三條斷言如預期變紅。
- e2e 6 條：直接讀真實 DOM 確認 32 個 `data-i18n` 節點都有文字、且文字等於
  `chrome.i18n.getMessage()` 的回傳（而非 HTML 裡的 fallback）、`__MSG_extName__` 有解析、
  版本徽章等於 manifest 版本、aria-label 有在地化、`<html lang>` 跟著 UI 語系。

`src/display.js` 維持純函式：`yarDescribeDisplay()` 的「內建/外接」改由呼叫端注入，
**不可**在裡面呼叫 `chrome.i18n` —— 該檔同時被 service worker 與 node:vm 測試載入，會炸 ReferenceError。

### CI 的兩個折衷

- **圖示不做 byte 比對**：ubuntu 的 librsvg 與開發機 homebrew 版本輸出未必逐位元組相同，
  那種檢查只會製造一條永遠紅、最後被忽略的 CI。改為驗 PNG 的 IHDR 寬高與 manifest 宣告一致。
- **對外連線掃描用 `--exclude-dir=tests` 而非事後 `grep -v "^./tests/"`**：
  grep 輸出前綴帶不帶 `./` 隨實作而異，靠字串過濾會安靜失準（本機實測誤報過一次）。

### 待辦

- [x] ~~贊助金流~~ 維持 PayPal（見上方「贊助金流」段落），無須註冊新帳號。
- [x] ~~商店素材~~ 1280×800 截圖 ×2、440×280 宣傳圖、128×128 商店圖示皆已產生並進版控，
      前兩者尺寸有 CI 守門。
- [x] ~~**`store-icon-128.png` 沒有產生腳本**~~ **2026-08-05 完成**。`tools/build-promo.sh`
      現在用 `rsvg-convert --page-width/--page-height/--top/--left`（需 2.52+）由
      `icons/icon.svg` 直接渲染成「96 內容置中於 128 畫布」，不需要第二個影像工具。
      守門的重點是**留白而非尺寸**：忘了那幾個參數的輸出照樣是 128×128，只驗 IHDR 擋不住。
      因此寫了 `tools/png-geometry.js`（零相依，node 內建 zlib 解 PNG、un-filter scanline
      後量不透明像素的邊界框），build 腳本、CI、單元測試三處共用。
      CI 另加一條**負向驗證**（滿版的 `icons/icon.png` 必須被擋下），
      測試也拿它當對照組——否則檢查退化成「永遠通過」不會有人發現。
- [ ] **送審**：上傳 `dist/auto-resizer-for-youtube-v3.0.0.zip`，填表照 `store-assets/store-listing.md`。
- [x] ~~上架後把商店連結補進 README、專案首頁與 `bobo-labs` 的 project card~~ **2026-08-05 完成**。
- [x] ~~**確認 Support URL 的修正已過審**~~ **2026-08-08 結案**：線上實測 `Version` = 3.0.1、
      舊網址殘留 0 次。Support URL（08-06 提交、08-07 過審）與**說明文案那一處**
      （從 v3.0.0 起就是舊的、從未提交過修改）都已清除。
      教訓見下方「2026-08-08」段落。

---

## 🖥️ v2.3.0 — 4K 與多螢幕適配

**本機組態（`chrome.system.display` 實測，2026-08-04）**

```
Display 1 內建 Color LCD   bounds 0,0     1710x1107  workArea top=34 高1073  isInternal isPrimary  DPR 2
Display 2 Philips UHDTV    bounds 1710,0  3840x2160  workArea top=30 高2130  外接              DPR 1
```

兩台**並排、4K 在右**。實體面板是 2880x1864 與 3840x2160，但重要的是邏輯寬度差 2.25 倍
（1710 vs 3840）而 DPR 反過來差一半。

- [x] **`autoByQuality` 的畫質原生寬上限在 4K 上變成主要限制（根因）**。3840px 視窗播 1080p 時
      播放器被鎖在 1920px。**同一段程式在內建螢幕上永遠量不出來**——1710px 的視窗裡
      1920 從來不是 binding constraint。這就是「只有換螢幕才會現形」的 bug。
      修法：`getAvailableQualityLevels()` 比對後，若影片本身已給不出更高畫質就拿掉上限。
      實測 4K：原生 1840 → 自動 3312（+80.0%），用掉視窗寬的 86.3%。
- [x] **依螢幕實體像素選畫質**：判準是「播放器 CSS 寬 × devicePixelRatio」。
      內建 1392x2 = 2784、4K 3312x1 = 3312 —— CSS 寬差一倍，需要的畫質卻相同（都是 2160p）。
      只看 CSS 寬會在 Retina 上長期要低了。新設定 `displayAwareQuality` / `autoQualityCeiling`。
- [x] **側欄被 flex-grow 拉寬**：4K 上播放器 1920、剩 1900px 全被 `flex: 1 1 400px` 吃掉。
      修法是限制 `#columns` 的 `max-width`（而非鎖 `#secondary` 的寬度——那會讓換行後撐不滿）。
      實測受限情境下側欄 400px（原本會是 ~1900）。
- [x] **彈出播放器可指定螢幕**（follow / largest / internal），依目標螢幕 workArea 算尺寸並置中。

## ⚠️ v2.3.0 兩個一定會踩的環境陷阱

1. **macOS 的 `chrome.system.display` 不提供 DPI**
   `dpiX` / `dpiY` **恆為 0**，`name` **恆為空字串**。原本設計想用 `dpr = dpiX / 96` 來分級，
   那會讓每台螢幕的實體寬度都算成 0。**DPR 只能從頁面端的 `window.devicePixelRatio` 拿，
   而且只涵蓋視窗目前所在那一台。** 分級函式必須容許 DPR 未知（未知時退回邏輯寬度判斷）。
   UI 標籤也不能用 `name`，要自己組（「內建 1710×1107 @2x」）。

2. **Brave 的指紋防護會竄改網頁端的 `screen.*` 與 `screenX/Y`**
   同一個 Brave 實例、同一時刻實測：

   | 來源 | 看到的螢幕 |
   |---|---|
   | YouTube 頁面 | `screen` 1680×1050、`screenX` 8（實際位置是 0,40） |
   | 擴充功能 service worker | `chrome.system.display` 1710×1107 與 3840×2160@1710 |

   **`chrome.system.display` 不受影響。** 這不只是測試環境問題：`windowSizeForQuality()` 原本就是用
   `screen.avail*` 算彈出視窗尺寸，在 Brave 上會拿 1680 去替 3840 的螢幕算，視窗小一半。
   已把尺寸決定權整個移到 service worker（content script 只送「內容需求」`windowFitRequest`，
   由 background 的 `yarSizeFromFitRequest` 用真實 workArea 夾擠）。
   **推論：任何需要真實螢幕尺寸的邏輯都不能寫在 content script。**

## 🖱️ 跨螢幕拖曳實測（2026-08-04，手動 + CDP 事件攔截）

CDP 不好模擬拖曳，改為開一個帶偵錯埠的 Brave 給使用者手動拖，同時輪詢狀態。分三輪。

**第三輪的方法才是關鍵**：只看「畫質有沒有變」會被 YouTube 的行為汙染，無法判斷是誰的問題。
改為在主世界注入監聽器攔截 `postMessage` 的 `YT_AUTO_RESIZER_ACTION / SET_QUALITY`
（`pageScript.js` 收的就是這個），**直接看擴充功能有沒有做出決定**，不從結果反推。

視窗固定 1308x828（只有 DPR 變、尺寸不變），來回拖 6 次：

| DPR | 播放器可長到 | 實體像素 | 應請求 | 實際送出 | resize | matchMedia |
|---|---|---|---|---|---|---|
| 1（4K TV） | 1292 | 1292 | hd1080 | **1080p** ✅ | ✅ | ✅ |
| 2（內建） | 1292 | 2584 | hd2160 | **2160p** ✅ | ✅ | ✅ |

**6/6 全中**：每一次跨螢幕，`resize` 與 `matchMedia` 都觸發，`SET_QUALITY` 都送出，且畫質正確。
最後停在 DPR 2，實測 `getPlaybackQuality()` = `hd2160`、影片 3840x2160、播放器 1292px
（與公式算出的 ceiling 完全相符）—— **升畫質 YouTube 會照做**。

⚠️ **降畫質 YouTube 不一定馬上照做**（第二輪觀察到請求降級後仍維持 hd1440 達 50 秒）。
這是 YouTube 端的行為不是我們的 bug，而且多半是好事：移到低 DPI 螢幕時
沿用已緩衝的高畫質只是多花頻寬，畫面不會變差。**要緊的方向（升）是通的。**

**方法論教訓（我在這裡錯過一次）**：第一輪我拿「基線 hd1440」與「首筆 hd720」的落差
**推論**跨螢幕重算有效，並回報為已驗證。第二輪直接觀測到 DPR 2→1 當下畫質沒動，推翻了它。
**相隔一段時間的兩個狀態不構成因果證據**——中間發生什麼都不知道。
第三輪攔截真正的決策訊號才定案。同課題見 [[feedback_working_is_not_effective]]。

## 🧪 v2.3.0 的測試設計

- **對照組門檻放在 e2e 而非單元測試**：`default` 模式回傳空字串，YouTube 原生寬度是外部事實，
  在單元測試裡模型化它只會得到自我實現的假門檻。單元測試守的是「有沒有被 cap 鎖死 / 會不會溢出 /
  內建螢幕有沒有退步」。
- **CSS 運算式要求值成像素再斷言**。`evalWidthExpression()` 把 `max(426px, min(3840px, calc(100vw - 16px), …))`
  在指定 viewport 下算成數字。斷言「CSS 裡有 100vw」在功能整個失效時照樣會過（v2.2.0 的教訓）。
- **防漂移測試**：`yarPlayerWidthFor`（JS）與 CSS 運算式求值必須在 180 組組合下算出同一個數字。
  這份重複是刻意的——content.js 需要在 JS 裡知道播放器能長多大才能反推畫質。
- **假通過抓到一次**：`[4K] 畫質受限時側欄不被拉寬` 一開始只等 4 秒就量，量到的還是未受限狀態
  （player 3312 而非 1920），斷言照樣通過。降畫質有 `QUALITY_SHRINK_SETTLE_MS`(4s) 的 settle，
  必須等 14 秒，**並且加一條「情境是否真的重現」的前置斷言**，否則那條檢查什麼都沒守。

## ✅ v2.3.0 實測結果

| | 內建 1600x863 viewport @2x | 4K 3840x1943 viewport @1x |
|---|---|---|
| default（不介入） | 1112x626 | 1840x1035 |
| autoByQuality | **1392x783（+25.2%）** | **3312x1863（+80.0%）** |
| 播放器實體像素 | 2784 | 3312 |
| 自動要到的畫質 | hd2160 | hd2160 |
| 側欄 | 換行撐滿 1600 | 並排 400（未被拉寬） |
| 畫質上限鎖 1080p 時 | — | 播放器 1920、側欄 **400**（修正前會是 ~1900） |
| 彈出視窗 | 1554x906 @螢幕1 | 3735x2130 @螢幕2（follow 正確） |
| 橫向溢出 | 無 | 無 |

單元測試 58/58；e2e 內建 29/29、4K 35/35。

**複審**（typescript-reviewer，2026-08-04）：Approve，無 CRITICAL / HIGH。三項 LOW 全數修正——
① `onMessage` 裡 fire-and-forget 的 async handler 補 `.catch`（原本仰賴「每個下游都不 reject」的隱性約定，
   下游一改就變成 service worker 裡沒有症狀的 unhandled rejection）；`GET_DISPLAYS` 出錯時仍回空清單，
   否則 popup 的 callback 永遠等不到。
② `dpr` 加上界 `YAR_MAX_DPR = 4`——它有一條來自訊息的路徑（popup 傳給 SW），
   不夾的話一個離譜數字就能把任何螢幕推成 UHD 分級。只夾上界：縮小頁面時 dpr < 1 是合法的。
③ `#popupTargetDisplay-select` 補 `aria-labelledby`。

另在自行的安全通道檢視中修掉一個：`yarShouldUpscale` 讀的 `availableQualities` 來自主世界的
YouTube player 物件（頁面可控），原本用 `YAR_QUALITY_WIDTH[code] || 0` 會沿原型鏈取到函式，
`Math.max` 得到 NaN。實測 `['hd1080','__proto__']` 舊寫法回 `false`（永遠不放大），已改用 `hasOwnProperty`。

跑法：`bash tests/run-e2e.sh`（內建）／`SCREEN=uhd bash tests/run-e2e.sh`（4K）。
~~⚠️ `run-e2e.sh` 的 `uhd` 座標寫死 `1710,40`，螢幕排列改變就要重新量。~~
**2026-08-07 已不再寫死**，改由 `tests/pick-screen.js` 執行期偵測（見本檔 2026-08-07 段落）。

---

## 📌 v2.2.0 — 「自動調整尺寸」其實一直沒有作用

使用者回報「還是不能自動」。量測後證實：**功能會跑、測試全綠、但實際只放大 16px。**

- [x] **寬度公式預扣 400px 側欄（根因）**：`yarReserveTwoColumn` 扣掉側欄 + 間距共 472px，
      於是播放器上限 = 視窗寬 - 472，而那正好是 YouTube 原生兩欄版面的寬度。
      1600x863 視窗實測 default 1112px vs autoByQuality 1128px，差 16px（1.4%）。
      更糟的是 4K 與 720p 都被同一個數字夾死 → `autoByQuality` 與 `fitWindow` 輸出**完全相同的 CSS**。
      **教訓：有對照組才叫驗證。** 舊測試只斷言「CSS 含 100vw / 100vh」，
      從沒拿「不啟用擴充功能」的尺寸比過，所以 20/20 全綠卻是壞的。
- [x] **改成「播放器先取空間、側欄撿剩下的」**：寬度只扣頁面內距與捲軸；
      側欄 `flex: 1 1 400px` + `#columns` `flex-flow: row wrap`，擠不下就自動換到播放器下方並撐滿。
      換行判斷交給瀏覽器，不需要 JS 監聽 resize。實測 1392x783（+25%），垂直空白 228px → 80px。
- [x] **`#columns` 的 min-width 是隱形的天花板**：YouTube 用 `--ytd-watch-flexy-player-width`
      反推 `#columns` 的 min-width（播放器 1392px 時算出 1760px）。不歸零的話：①整頁長出橫向捲軸
      ②**側欄永遠不會換行**——min-width 撐著，flex 容器不覺得空間不足。
- [x] **ABR 抖動**：放大後才看得出來。YouTube 開播時畫質由低往上爬，播放器跟著跳好幾次。
      改為升畫質立即跟進、降畫質需持續 4 秒（`QUALITY_SHRINK_SETTLE_MS`）才縮。
- [x] **`#bottom-row` 的 -6px 負邊界**：零留白模式把頁面內距歸零後，這 12px 外擴就變成橫向捲軸。
      原本是靠 YouTube 自己的 16px 內距吸收的。已用 `overflow-x: clip` 就地夾住。
- [x] 側欄換行後播放器置中（靠左會在右邊留一條空白）；不再相依 `[is-two-columns_]` 私有屬性。

## 📌 v2.2.0 — 彈出視窗身分改由 service worker 認定

- [x] URL hash 標記是**競態**：YouTube SPA 載入後 `replaceState` 清掉 hash，
      而 content script 在 `document_idle` 執行。慢一步就永遠讀不到 → 套用一般版面（頁首、推薦欄都在）。
      v2.1 的「認出過一次就記住」只在「有認出過」時有效，沒解決根本問題；本次 e2e 就重現了失敗。
      **修法：service worker 是唯一知道「這個分頁是我開的」的一方**，由它記住 tabId
      （存 `storage.session` 以撐過 SW 閒置回收）並回答 `IS_POPUP_PLAYER`。
- [x] 回覆是非同步的，這之前可能已經裝上彈出按鈕 → 確認身分後要 `removePopupButton()`。

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

## ✅ 實測結果（v2.2.0，Brave，視窗內容區 1600x863）

| 情境 | 播放器 | 側欄 | 橫向溢出 |
|---|---|---|---|
| default（不介入） | 1112x626 | 並排 456 | 否 |
| autoByQuality / 4K | **1392x783** | 換行到下方 1600 | 否 |
| autoByQuality / 240p 影片 | **426x240**（原生尺寸不放大） | 並排 1150 | 否 |
| fitWindow / 同一支 240p | **1392x783** | 換行 | 否 |
| theater | 1392x783 | 換行 | 否 |

多視窗尺寸壓力測試（CDP `Emulation.setDeviceMetricsOverride` 改 viewport，比 `chrome.windows.update` 可靠）：

| viewport | 播放器 | 側欄 |
|---|---|---|
| 1600x1000 | 1584x891 | 換行 |
| 1200x900 | 1184x666 | 換行 |
| 900x800 | 884x497 | 換行 |
| 1900x700 | 1102x620 | **並排 774**（高度受限，寬度有剩） |
| 700x700 | 684x385 | 換行 |

全部情境皆無橫向溢出。`default` 模式在 1200x900 的模擬 viewport 下會溢出 21px —— 那是 YouTube
自己的版面（我們一行 CSS 都沒出），不是本擴充功能造成的。

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

~~`--window-position` 的 y 給 40 避開 macOS 選單列。~~
⚠️ **2026-08-07 更正：`--window-size` / `--window-position` 這兩個旗標不可以用。**
Brave 會拿它們覆蓋之後每一個 `chrome.windows.create` 的座標而且不報錯，
讓所有「視窗開在哪台螢幕」的檢查失去意義（詳見本檔 2026-08-07 段落）。
視窗位置改由 `tests/pick-screen.js` 在啟動後用 `chrome.windows.update` 設定。
端到端腳本已進版控：`tests/e2e.js` + `tests/run-e2e.sh`（一鍵跑）。

⚠️ **Brave 會偽裝 UA 成 "Google Chrome" 並移除 `navigator.brave`**，不可用 UA 判斷瀏覽器。
⚠️ 判斷擴充功能是否為自己的，要用「絕對路徑 SHA256 前 32 hex 映射 a-p」算 ID 比對。

## ✅ 端到端實測結果（Brave，視窗 1600x1000）

| 項目 | 實測 |
|---|---|
| 設定面板 → content script | 改模式即時反映（default styleLen 0 / auto 6867） |
| **放大幅度對照** | 原生 1112x626 → 自動 1392x783（**+25.2%**） |
| 垂直空間 | 剩 80px / 863px |
| 原生劇院 | 完全不介入，播放器滿寬 1600，無溢出 |
| 彈出視窗比例 | 1.784 vs 16:9 基準 1.778 |
| 彈出視窗黑邊 | 空隙 0x0 |
| Service worker | 已註冊（檢查須緊接喚醒動作，MV3 閒置 30 秒就回收） |
| 頁面例外 | 0 |

端到端 26/26、單元測試 32/32 綠。

**測試環境兩個坑**：
- 全新 profile 會被 YouTube 擋機器人驗證牆（「登入帳戶以確認你不是機器人」），
  此時 `getPlaybackQuality()` 回 `unknown`、`videoWidth` 為 0。版面量測仍有效，但畫質相關的路徑量不到。
  換一支影片通常就過（實測 `aqz-KE-bpKQ` 被擋、`LXb3EKWsInQ` / `jNQXAC9IVRw` 正常）。
- 彈出視窗在全新 profile 不會自動播放（媒體互動分數為零），長寬比校正會走 16:9 退路。

---

## 🎯 Next Session Goals

- [x] ~~**拖曳視窗跨螢幕的即時反應未實測**~~ **2026-08-04 手動實測完成，見下方「跨螢幕拖曳實測」。**
- [x] ~~**`content.js` 已 661 行**~~ **2026-08-07 完成**：抽出 `src/quality-policy.js` 與
      `src/window-fit.js`，662 → 581 行，並加了 800 行的守門測試。
- [x] ~~`SCREEN=uhd` 的 e2e 視窗座標寫死 `1710,40`~~ **2026-08-07 完成**：改由
      `tests/pick-screen.js` 在執行期問 `chrome.system.display`。副產品是發現
      `--window-position` 一直在讓彈出視窗定位的檢查失效（見上方 2026-08-07 段落）。

- [x] ~~設定面板端到端未測~~ **已完成**：e2e 直接開 `chrome-extension://<id>/popup.html`
      並用它寫 `chrome.storage.sync`，覆蓋 popup → storage → content script 全鏈路。
- [x] ~~**非 16:9 影片未實測**~~ **2026-08-07 完成，而且原本的判斷是錯的**：
      「直式影片有黑邊＝同 YouTube 原生行為」不成立，是我們寫死的 9/16 把容器壓扁，
      可見影像比不裝擴充功能還小 14.8%。已改為跟隨影片長寬比（見上方段落）。
      ⚠️ 遺留：YouTube 逐 session 決定 Shorts 要送 9:16 還是 padded 16:9，觸發條件未查明，
      因此 e2e 的直式區塊拿不到 9:16 串流時會大聲略過，守門在 `unit.test.js`。
- [x] ~~**側欄並排時會被拉寬**（240p 影片實測 1150px）~~ **2026-08-07 複驗：已被 v2.3.0 修掉**。
      同情境（player 426 / viewport 1670 / 剩餘 1244px）實測側欄 = 400px。
      已補一條內建螢幕跑得到的 e2e 檢查，含情境重現前置斷言。
- [x] ~~**多螢幕情境未測**~~ **v2.3.0 已完成**（見上方 v2.3.0 段落）。
      剩下未測的多螢幕子題：**把視窗從一台拖到另一台**時的即時反應。
      已實作 `matchMedia('(resolution: Ndppx)')` 監看 + 500ms debounce 的 resize 重算，
      但只在同一台螢幕上縮放驗過，沒有真的拖曳跨螢幕測過（CDP 不好模擬，需手動）。
- [ ] 觀察 Chromium 更新後 YouTube Polymer 版面變化——
      `theater` / `full-bleed-player` 兩個屬性名仍是外部相依（`is-two-columns_` 已在 v2.2.0 拿掉）。
      YouTube 若改用別的變數算 `#columns` 的 min-width，換行邏輯也會失效。
