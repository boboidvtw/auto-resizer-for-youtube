# Project Context & Handoff Log - Auto Resizer for YouTube™

> Last Closed: 2026-08-05T14:56:07+08:00 (v3.0.0 收尾 — 商店素材補齊，程式碼零變更)
> 前一版：2026-08-05 (v3.0.0 — Chrome Web Store 上架前合規整備, commit ad6e4f8)
> 更前一版：2026-08-04T20:54:25+08:00 (v2.3.0, code commit b7c4eb2 — 4K / 多螢幕適配；
> 跨螢幕拖曳實測於 d3b4686 補記)

**本次收工的實際狀態**：沒有新的程式修改。工作區只剩一個未追蹤的商店素材
`store-assets/store-icon-128.png`（128×128、圖形佔中央 96×96、四周 16px 透明邊），
已補進版控並在 `store-assets/store-listing.md` 的素材表登記。
單元 + i18n 測試 **70/70 綠**（`node --test tests/unit.test.js tests/i18n.test.js`）；
e2e 本次未重跑（需要 Brave + 真實 YouTube，程式碼未動故沿用 v3.0.0 的結果）。

**下一步只剩一件事：把 `dist/auto-resizer-for-youtube-v3.0.0.zip` 上傳到 Chrome Web Store。**
填表逐欄的對照文字在 `store-assets/store-listing.md`（含三語 description、single purpose
說明、每個權限的 justification）。

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
- [ ] 上架後把商店連結補進 README、專案首頁與 `bobo-labs` 的 project card。

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
⚠️ `run-e2e.sh` 的 `uhd` 座標寫死 `1710,40`，**螢幕排列改變（左右對調、換解析度）就要重新量**
（用 `chrome.system.display.getInfo()`）。

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

`--window-position` 的 y 給 40 避開 macOS 選單列。
端到端腳本已進版控：`tests/e2e.js` + `tests/run-e2e.sh`（一鍵跑，20 項檢查）。

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
- [ ] **`content.js` 已 661 行**，逼近 `coding-style.md` 的 800 上限。
      下次動它之前先考慮拆分（螢幕感知那一段是自然的切點）。
- [ ] `SCREEN=uhd` 的 e2e 視窗座標寫死 `1710,40`。螢幕排列改變（左右對調、換解析度）
      就會開到錯的地方，要用 `chrome.system.display.getInfo()` 重新量。
      本 session 中途就遇過內建螢幕縮放被改動，不是假設性風險。

- [x] ~~設定面板端到端未測~~ **已完成**：e2e 直接開 `chrome-extension://<id>/popup.html`
      並用它寫 `chrome.storage.sync`，覆蓋 popup → storage → content script 全鏈路。
- [ ] **非 16:9 影片未實測**。彈出視窗長寬比已改用 `video.videoWidth/videoHeight`
      且單元測試涵蓋 4:3，但沒在真機驗過直式影片 / Shorts。
      另外 watch 頁的 `--yar-player-h` 仍寫死 9/16，直式影片會有大片上下黑邊（同 YouTube 原生行為）。
- [ ] **側欄並排時會被拉寬**（240p 影片實測 1150px）。flex-grow 讓它撿走所有剩餘空間，
      推薦影片卡片會被拉長。要不要設上限待觀察。
- [x] ~~**多螢幕情境未測**~~ **v2.3.0 已完成**（見上方 v2.3.0 段落）。
      剩下未測的多螢幕子題：**把視窗從一台拖到另一台**時的即時反應。
      已實作 `matchMedia('(resolution: Ndppx)')` 監看 + 500ms debounce 的 resize 重算，
      但只在同一台螢幕上縮放驗過，沒有真的拖曳跨螢幕測過（CDP 不好模擬，需手動）。
- [ ] 觀察 Chromium 更新後 YouTube Polymer 版面變化——
      `theater` / `full-bleed-player` 兩個屬性名仍是外部相依（`is-two-columns_` 已在 v2.2.0 拿掉）。
      YouTube 若改用別的變數算 `#columns` 的 min-width，換行邏輯也會失效。
