# 架构

本文描述当前代码实际如何运行。分包算法与体积模型见 [`SHARDING.md`](./SHARDING.md)，约束与红线见 [`AGENTS.md`](../AGENTS.md)。

## 总览

```text
┌──────────────────────────── 主线程 ────────────────────────────┐
│ ui (React)  ──读──▶  AppState（store） ◀──写──  AppController    │
│    │                      ▲                          │          │
│    └── AppServices ───────┘ derive.ts（记忆化选择器）  │ ports    │
│        （平台动作注入）                               ▼          │
│                         EnginePool ── CharsetRepository ── ZIP  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ Comlink + transfer
          ┌─────────────────────┼─────────────────────┐
     engine.worker × N（≤ 6）  … 每个：HarfBuzz WASM + 嵌套 wawoff2 Worker
```

- 纯静态 SPA：Vite 8、React 19、Tailwind 4、TypeScript strict（含 `exactOptionalPropertyTypes`）。
- 没有后端。网络请求只有应用资源、字表与字频 JSON，以及 Service Worker 更新。

## 分层

| 目录            | 内容                                                                                      | 可依赖                           |
| --------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `src/core/`     | 码点集合、字频模型、场景、分包规划与指标、导出计划、命名、CSS、报告/README/demo 文本      | core、`data/unicode-blocks.json` |
| `src/app/`      | `store`、`state`（状态与持久化）、`derive`（选择器）、`controller`、`ports`、上传签名校验 | app、core                        |
| `src/engine/`   | Worker 协议、体检、体积校准、HarfBuzz 封装、SFNT 表读写、WOFF1/WOFF2、线程池              | core、app/ports、generated       |
| `src/platform/` | 字表仓库、ZIP Worker、下载/剪贴板/目录写入、FontFace 验证与预览、Service Worker、文本导入 | core、app/ports                  |
| `src/ui/`       | 页面骨架、各工作区段、计划面板、结果与试玩区、基础组件                                    | app、core、i18n                  |
| `src/i18n/`     | 语言与主题偏好                                                                            | core                             |

`src/App.tsx` 是唯一组合根：懒创建 `EnginePool`、`CharsetRepository`、平台动作（FontFace 验证、预览工厂、ZIP、下载、目录写入、文本读取），创建 `AppController` 并通过 `ServicesContext` 提供给 UI；同时负责 Service Worker 注册、更新提示与在线状态。

分层由 ESLint 自定义规则强制：`architecture/source-layers` 解析真实目标路径，检查静态/动态/类型 import 与 `require`；`architecture/no-platform-globals` 拒绝 core 中的浏览器与 Worker 全局。`tools/verify-architecture-boundaries.mjs` 用 42 个应被拒绝、10 个应被允许的探针验证规则本身没有失效。

## 状态

`src/app/store.ts` 是一个最小的可订阅 store（`getState / setState / subscribe`）。UI 通过 `useStoreSelector`（`src/ui/use-store.ts`）订阅切片，默认使用浅比较。

`AppState` 的主要字段：

| 字段         | 含义                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| `fonts`      | 字体条目：`File`、状态、体检结果、款式草稿（family、字重、可变模式）        |
| `rejected`   | 签名校验拒绝的文件与原因                                                    |
| `characters` | 语言（自动或指定）、覆盖范围档位、附加字符、字表库、自定义文本与区间        |
| `plan`       | 分包方式（按需分片 / 单文件）与粒度                                         |
| `output`     | URL 前缀、font-display（只影响 CSS）；hinting、排版特性、元数据（影响分片） |
| `data`       | 字表索引、已加载预设、字频数据及其加载状态                                  |
| `run`        | 生成阶段、进度（完成片数、字节、线程数、已完成集合）、结果、错误            |

`src/app/derive.ts` 的选择器都经 `memoizeLast` 记忆化：

- `selectFontScript`：首个就绪字体的文字类型（`core/font-script.ts`）。带有至少 10 个汉字、40 个假名或 100 个谚文音节为 `cjk`，否则为 `western`（拉丁正文字体、代码等宽字体、图标字体）；还没有字体时按 `cjk` 展示。
- `selectLanguageDetection`：语言为"自动"时，先按用户文本的简繁似然判断，再按首个字体对三份代表字表（通规一级、教育部常用字、香港常用字）的覆盖比例判断，都没有依据时默认简体。西文字体不使用语言，界面以"文字"行代替。
- `selectCharacterTarget`：按语言与档位取字表（`core/character-settings.ts` 的 `levelPresetIds`），并入附加字符、字表库、自定义文本与区间；用户文本含假名/谚文且字体也提供这些字形时自动补整套。西文字体不取汉字字表与附加字符，"常用 / 完整"两档改为 `fontRanges`（`WESTERN_LEVEL_RANGES` 的西欧与多语言区块），由 `core/export-plan.ts` 的 `availableFor` 取字体自身落在区间内的字符，不计入缺字。
- `selectLevelEstimates`：对四档各规划一次，给出字数、每页期望下载、文件数与单文件估算，供字符区的阶梯卡片实时对比；界面用 `useDeferredValue` 让主计划先更新。
- `selectUsageModel`：`createUsageModel(frequency, profile, customText)`。
- `selectExportPlan`：`createExportPlan(...)`，即每个输出款式的分片计划、估算与问题列表。
- `selectBlockers`：阻止生成的原因（无字体、体检中、字体出错、字表加载中/失败、区间错误、生成中）。
- `selectInputKey`：影响分片字节的全部输入的哈希，用于判断结果是否过期。只影响 CSS 的设置（路径、font-display）不计入，改动后结果区的代码与 ZIP 即时重新生成。

设置以 400 ms 防抖写入 `localStorage['webfont-slice:settings:v3']`，读取时逐字段校验；自定义文本不持久化。

## 控制器

`AppController`（`src/app/controller.ts`）拥有全部副作用：

- `start()`：加载字表索引、字频、当前目标与语言判断所需的字表；1.2 s 后预取当前语言其他档位的字表，让阶梯对比与切换即时可用；订阅设置持久化。返回的清理函数会重置中断状态，使控制器可以再次 `start()`（开发模式的 StrictMode 会挂载两次）。
- `addFiles`：读取前 4 字节签名，拒绝伪装、TTC 与未知格式，按内容去重后排队。
- 体检泵：最多 3 个并发体检；首个字体就绪后，西文字体与几乎不含汉字的 CJK 字体默认改为"全部"档。用户手动改过字符设置后不再干预。
- `generate()`：
  1. 按源字体分组输出，按字体体积与设备内存选线程数，`engine.openSession` 在每个线程载入一次字体；
  2. 所有分片并行子集化，完成即更新进度（驱动计划面板的逐片点亮）；
  3. 每片经 `FontFace` 验证，计算内容哈希并生成文件名；
  4. 汇总实测指标，构建 `RunResult`（打包上下文 + 分片字节）。
- `resultPackage(result, locale, textSettings)`：按当前语言与只影响 CSS 的设置即时生成文本文件，不重新子集化。
- 取消：`AbortController` 传播到每个 `await`；`cancelRun` 终止线程池，在途体检重新排队。

## 引擎

`EnginePool`（`src/engine/pool.ts`）实现 `FontEngine` 端口：

- `inspect(file, signal)`：在任一空闲线程完成归一化、体检与校准。
- `openSession(file, key, threads, signal)`：扩充到所需线程数，每个线程 `open` 一次字体，返回在各线程间排队的 `SubsetSession`。
- 线程崩溃（`error` 事件）立即让在途请求失败；`trim()` 回收空闲线程；`terminate()` 用于取消。

`engine.worker.ts` 暴露 `inspect / open / subset / close`：

1. `normalize`：签名判定格式，WOFF2 经 wawoff2、WOFF1 经项目内逐表解包得到 SFNT；归一化结果超过 100 MB 拒绝，超过 64 MB 给出警告。
2. `inspectFont`（`font-inspector.ts`）：opentype.js 读取名称、cmap、轴与命名实例；`sfnt.ts` 直接读取表目录、布局特性、`hmtx` 步进宽度，以及 glyf/loca、CFF/CFF2 CharStrings 与 gvar 中逐字形的原始字节。ASCII 字母数字齐全时按步进是否全部相同判断等宽（`monospace`），否则采信 `post.isFixedPitch`。
3. `calibrateGlyphCosts`（`calibration.ts`）：4 次实测子集化求出 `overhead`、`ratio`、`runScale`、`baseScale`；西文字体再按文字分组各测一次 `familyRunScales`（见 `SHARDING.md`）。
4. `subset`：`HarfBuzzSubsetter` 调用 hb-subset（在默认保留集之外追加 `core/layout-features.ts` 中的网页常用特性：CJK 标点挤压、数字特性、代码字体的 `ss01`–`ss20` 与 `cv01`–`cv99`；丢弃 DSIG/hdmx/LTSH/VDMX/PCLT，默认去除 hinting），随后按 Windows 英文记录只保留 name ID 0–7、13、14、16、17、21、22、25 并重建 SFNT 校验和；再经 wawoff2 编码，WOFF2 字节 transfer 回主线程。

hb-subset 每次调用都会把字体复制进 WASM 堆，堆只增不减；这是按线程估算 `24 MB + 3.2 × 字体体积` 内存预算的原因（`core/threads.ts`）。

## 输出

`src/core/output-package.ts` 从生成结果构建：

- `fonts.css`：每片一条 `@font-face`（`unicode-range`、`font-display`、可变轴范围），只声明本字体：不生成回退字体、`local()` 或度量覆盖，回退栈由使用者自己写。文件名 `<prefix>-<variant>-<index>.<hash>.woff2`，前缀默认取字族名 slug，可按字族自定义。
- `preload.html`：基础片与高概率片的 `<link rel="preload">`，最多 3 个。
- `demo.html`：用本地服务器打开后，通过 `PerformanceObserver` 显示浏览器实际请求的分片。等宽字体默认显示代码片段（连字、易混字符、制表符），西文字体显示多语言样例。
- `report.json`（`webfont-slice/report@4`）：设置（含 `characters.script`）、逐款式可用/缺字与是否等宽、单文件估算、逐片字符数、实测与估算体积、三种页面长度下的加载概率与 `unicode-range`；`homepage` 指向源代码仓库。
- `README.md`：部署步骤与缓存建议。用法示例中第一个正文字族用于 `body`，第一个等宽字族用于 `code, kbd, samp, pre`。

`src/platform/zip.worker.ts` 在短生命周期 Worker 中用 fflate 打包（WOFF2 使用 store，文本使用 deflate 6）。支持 File System Access API 的浏览器还可以直接写入本地目录。

结果区的试玩区（`src/ui/result/Playground.tsx`）把生成的分片以 blob URL 注册为带 `unicode-range` 的 `FontFace`（`platform/font-faces.ts` 的 `ShardPreviewSet`），浏览器按输入文本真实地只加载命中的分片，界面通过 `document.fonts` 事件列出已请求的分片。

## 界面

工作台只有两个设置区块和一个计划面板：

- **01 字体**（`ui/fonts`）：卡片显示字族、格式、体积、字形数、可变轴、等宽标记与覆盖（CJK 字体为简/繁/假名/谚文，西文字体为拉丁/拉丁扩展/希腊/西里尔/制表符/图标）；预览按文字类型显示中文、西文或代码样例；折叠区内是字体信息（布局特性中会保留到输出的高亮）和输出设置（CSS 字族名、文件名前缀、字重、样式、可变字体保留轴或固定款式）。
- **02 字符**（`ui/characters`）：语言行（自动判断结果与手动覆盖；西文字体为"文字"说明行）、覆盖范围四档阶梯（仅文本 / 常用 / 完整 / 全部，西文字体为仅文本 / 西欧 / 多语言 / 全部；每档实时显示字数、每页下载与文件数，推荐档来自 `selectRecommendedLevel`）、你的文本（显示被自动补入的字与检测到的假名/谚文）、缺字面板；"高级"折叠区放附加字符（仅 CJK）、码点区间与 31 份字表库。
- **计划面板**（`ui/plan/PlanPanel.tsx`）：页面长度切换、加载概率图（`LoadChart`：宽度 ∝ 体积，高度 ∝ 加载概率，悬停或方向键选中的分片详情显示在图下方的信息条里，不用浮层）、每页预计下载等指标、分包方式与粒度滑杆、建议与阻塞项、生成按钮；"高级"折叠区放 hinting、排版特性、元数据三个影响分片字节的开关。大屏在右侧常驻并可内部滚动，小屏由 `PlanSheet` 的吸底条承担，点击展开为底部抽屉；两者只渲染一份（`useMediaQuery`）。
- **03 结果**（`ui/result`）：统计、真实按需加载的试玩区、接入设置（字体路径、font-display，改动即时反映到代码与 ZIP）、接入代码、分片明细。

提示气泡（`primitives.tsx` 的 `Hint`）在打开时测量触发元素位置，用 `position: fixed` 夹在视口内，不会被容器裁切。

## 可变字体

体检读取 `fvar` 的轴与命名实例。字体卡片里可选两种输出：

- **保留可变轴**（默认）：输出保留 `fvar` 与变体表的一套分片；`wght` 生成 `font-weight: 100 900` 这样的范围，`wdth` 生成 `font-stretch` 范围；体积估算把 `gvar` 中每个字形的变体数据计入。
- **固定款式**：从命名实例中多选，每个实例把全部轴固定后由 HarfBuzz 输出静态字体（移除 `fvar/gvar/avar/HVAR`），`wght / wdth / ital` 映射为静态 CSS 描述符。只列出 `wght / wdth / ital` 可变、其余轴处于默认值且 CSS 坐标互不相同的实例，最多 24 个。以 Noto Sans SC Variable 为例，通规全表固定为 Regular 后 WOFF2 总量比保留轴少约 45%。

预检拒绝未知或越界的轴坐标、固定模式未选实例、款式坐标冲突与文件名冲突。任意轴子范围、按 `opsz` 自动拆分 family 不在范围内。

## PWA

vite-plugin-pwa 采用 `prompt` 更新策略：新版本就绪后只在没有生成任务时提示，刷新必须由用户触发。首次访问后应用代码、WASM 与字表数据可离线使用；页头显示离线就绪状态。

## 测试

- 单元测试（Vitest）：core 全部模块、engine 的体检/SFNT/WOFF/校准、app 的控制器与状态、UI 的关键交互（jsdom）。
- 引擎集成测试：真实 HarfBuzz WASM 子集化 OFL 测试字体。
- E2E（Playwright）：完整流程（CJK、代码等宽字体、仅文本、签名拒绝、可变字体）、页头 GitHub 链接与偏好持久化、窄屏与底部抽屉、离线生成、axe 无严重违规；Firefox 与 WebKit 运行跨浏览器主流程。
