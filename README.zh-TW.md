# WebFont Slice

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [简体中文](README.zh-CN.md) · **繁體中文** · [한국어](README.ko.md) · [日本語](README.ja.md)

把中文、日文、韓文字型切成按需載入的 WOFF2 分片，產生可以直接部署的 `unicode-range` CSS；西文正文與程式碼等寬字型則按文字切分，連字與樣式集原樣保留。完全在瀏覽器本機執行，字型不會上傳。

原始碼：<https://github.com/DejavuMoe/webfont-slice>（MIT）

![WebFont Slice 工作台，已載入 Noto Sans SC Variable](docs/images/workbench-cjk.png)

一款 CJK 字型動輒 7–20 MB。WebFont Slice 依真實字頻估算每個字出現在頁面上的機率，再用動態規劃決定切在哪裡，讓一個頁面只下載它真正用到的字形：

| 覆蓋範圍（Noto Sans SC Variable） |   字數 | 單一檔案（實測） | 文章頁實際下載（實測，1500 字） | 相較單一檔案 |
| --------------------------------- | -----: | ---------------: | ------------------------------: | -----------: |
| 常用（通用規範漢字表一級）        |  3,701 |           945 KB |            810 KB · 12.5 個檔案 |         −14% |
| 完整（通用規範漢字表全表）        |  8,306 |          2.13 MB |            868 KB · 14.9 個檔案 |         −60% |
| GBK（字表庫）                     | 21,124 |          5.37 MB |            879 KB · 15.1 個檔案 |         −84% |
| 全部（字型全部字元）              | 30,890 |          7.41 MB |            891 KB · 15.1 個檔案 |         −88% |

每頁下載量幾乎與字元集大小無關：範圍從 3 千字擴到 3 萬字，文章頁只多約 80 KB。數字來自 `pnpm benchmark:planner --measure`——逐片真實子集化後再依字頻計算期望值；方法與更多字型見 [`docs/SHARDING.md`](docs/SHARDING.md)。

### 西文與程式碼字型

不含漢字的字型（拉丁正文字型、JetBrains Mono / Fira Code 這類程式碼等寬字型、帶圖示的 Nerd Font）會被自動辨識，覆蓋範圍改為依 Unicode 區塊定義的四個等級：僅文字、西歐、多語言（加上拉丁擴充、希臘、西里爾）、全部。中間兩個等級只取字型本身有的字元，不會冒出成百上千個「缺字」。ASCII 與常用標點進基礎片，其餘依文字分組裝箱——希臘、西里爾、製表符與箭頭、私用區圖示各自成片，純英文頁面通常只下載基礎片。

| 字型（全部字元）     |  字元 | 片數 | 單一檔案（實測） | 頁面通常只下載 |
| -------------------- | ----: | ---: | ---------------: | -------------: |
| JetBrains Mono 2.304 | 1,363 |    5 |            55 KB |   19 KB 基礎片 |
| Fira Code 6.2        | 1,586 |    6 |            67 KB |   23 KB 基礎片 |

等寬字型會被標示出來。「保留排版特性」開啟時（預設）除了 `calt`/`liga` 連字，還保留 `ss01`–`ss20` 樣式集與 `cv01`–`cv99` 字元變體，可以在自己的 CSS 裡用 `font-feature-settings` 切換；產生的用法範例把等寬字族指向 `code, kbd, samp, pre`，結果頁與 `demo.html` 以程式碼片段預覽。

## 三步

1. **拖入字型**：TTF、OTF、WOFF 或 WOFF2，依檔案簽章辨識，單一檔案上限 100 MB；同一字族的多個字重可以一起拖進來。
2. **選覆蓋範圍**：語言自動判斷；四個等級由小到大——僅文字、常用、完整、全部（西文字型為僅文字、西歐、多語言、全部），每個等級即時顯示字數、每頁預計下載與檔案數。寫部落格的建議做法：選「常用」，再把幾篇文章貼進「你的文字」，文章裡的生僻字會自動補上，常用的字會優先載入。
3. **產生並部署**：右側計畫面板顯示每頁預計下載、請求數與每片載入機率，拖動粒度滑桿即時更新；產生後在頁面裡輸入文字試一試，瀏覽器只會請求命中的分片。下載 ZIP 或直接寫入專案資料夾。

```text
<family>-webfont.zip
├─ fonts.css      @font-face + unicode-range，只宣告本字型
├─ fonts/         WOFF2 分片，檔名帶內容雜湊
├─ preload.html   預載標籤
├─ demo.html      觀察分片按需載入
├─ report.json    逐片字元、大小與載入機率
└─ README.md      這次產生的部署說明
```

部署方法見 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

![結果頁：這段範例文字下，瀏覽器只請求了 26 片中的 7 片](docs/images/result.png)

## 特點

- **依字頻規劃分片**：高頻字合併成少數幾片、中頻區切細、長尾依碼位裝箱；基礎字元單獨成片並建議預載。粒度只有一個滑桿，從「更省流量」到「更少檔案」。
- **產生前就知道結果**：大小模型用這款字型的 4 次實測子集化校準，分片總量估算偏差在 ±3.5% 內；每頁預計下載與實測相差 −1%～+4%。介面上每個數字都是算出來的。
- **只做切片**：CSS 只宣告你上傳的字型，不附加任何回退字型或度量覆寫，回退堆疊由你在自己的 `font-family` 裡決定。產物包括內容雜湊檔名、預載標籤、部署說明與逐片報告；檔名前綴預設取自字族名，也可以自訂（如 `lxgw-400-87.f73f604a.woff2`）。路徑與 `font-display` 只影響 CSS，在結果頁改動會即時反映到程式碼與 ZIP。
- **真實的按需載入試玩**：產生後在頁面裡輸入文字，瀏覽器依 `unicode-range` 只請求命中的分片，介面列出實際請求的檔案。
- **涵蓋常用字表**：通用規範漢字表、教育部常用國字、香港常用字與 HKSCS、Big5、GB 2312 / GBK / GB 18030、Unicode 區塊；簡體與繁體各有字頻檔案。
- **西文與程式碼字型**：自動辨識不含漢字的字型與等寬字型，依文字分片，保留連字、樣式集與字元變體。
- **可變字型**：保留可變軸，或從具名實例中挑選只需要固定款式。
- **多執行緒**：依字型大小與裝置記憶體選擇執行緒數；17 MB 的 Noto Sans SC Variable 產生 26 片約 1 秒。
- **本機、離線**：沒有後端與遙測；PWA 首次造訪後可離線使用；中英文介面，淺色/深色主題；手機上有可展開的底部計畫面板。

## 隱私與授權

- 沒有後端。檢查、子集化、WOFF2 編碼與打包都在目前頁面的 Web Worker 與 WASM 中完成；瀏覽器只請求應用程式碼、WASM、字表與字頻 JSON 以及 Service Worker 更新。
- `localStorage` 只儲存介面偏好與字元/分包/輸出設定，**不儲存自訂文字**；字型、分片與 ZIP 只存在於記憶體和你主動下載的位置。
- **本工具不授予任何字型權利。** 子集化通常構成修改，網頁部署通常構成內嵌與再散布；許多商業字型禁止這麼做，部署前請確認授權。預設的「精簡中繼資料」只刪除網頁用不到的 `name` 記錄，著作權、字族、授權說明與連結一律保留。

## 開發

需要 Node.js 24+、pnpm 11.24+。

```bash
corepack enable
pnpm install          # 同時產生本機拆分的 wawoff2 WASM
pnpm dev              # http://localhost:5173
pnpm check            # lint + 架構探針 + 格式 + 單元測試與覆蓋率 + 資料驗證 + 建置
pnpm test:e2e         # 先建置後執行 Playwright（Chromium 全套，Firefox/WebKit 主流程）
pnpm benchmark:planner path/to/font.ttf --measure
```

`pnpm build` 產生純靜態的 `dist/`，可以部署到任意靜態主機，子路徑無需額外設定。推送 `master` 後由 Woodpecker CI 建置並以原子符號連結切換發佈，見 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。

## 非目標

- 伺服器、CLI 或建置外掛版本（目前只做瀏覽器應用程式）。
- TTC/OTC 字型合輯拆分（請先匯出單一字型）。
- 任意可變軸座標或子範圍、依 `opsz` 自動拆分 family。
- 字形編輯、字型合併，或字型格式轉換以外的字型改造。

## 文件

- [`docs/SHARDING.md`](docs/SHARDING.md)：分包模型、目標函數、大小估算、基準與效能
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：分層、狀態、介面、Worker 與可變字型
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)：部署工具本身與產生的字型
- [`docs/DATA.md`](docs/DATA.md)：字表與字頻來源
- [`AGENTS.md`](AGENTS.md)：貢獻與編碼代理規範
- [`CHANGELOG.md`](CHANGELOG.md)：變更記錄

## License

程式碼採用 [MIT](LICENSE) 授權；第三方相依、資料與測試字型見 [`NOTICE`](NOTICE)。問題與建議請提交到 [GitHub Issues](https://github.com/DejavuMoe/webfont-slice/issues)。
