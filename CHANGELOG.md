# Changelog

## 2.0.0 — 未发布

重写。产品从"按固定规则切字表"变为"按字频与体积模型规划分片"，界面、核心算法、引擎并发模型、输出结构和文档全部重做。

### 西文与代码字体

- 自动识别字体的文字类型：没有成规模汉字、假名或谚文的字体（拉丁正文字体、代码等宽字体、图标字体）按西文处理，不再套用汉字字表。语言行换成"文字"说明，四档变为仅文本 / 西欧 / 多语言 / 全部；中间两档按 Unicode 区块取字体自身字符，字体没有的字符不算缺字；默认推荐"全部"。
- 识别等宽字体（ASCII 字母数字步进相同，或 `post.isFixedPitch`）：卡片标记"等宽"并用代码预览；结果页与 `demo.html` 默认显示代码片段；用法示例把等宽字族指向 `code, kbd, samp, pre`。
- 长尾先按文字分组再按码点装箱，并在拉丁、希腊、西里尔、符号与制表符、CJK、谚文、私用区图标等分组边界切开（当前片不小于 `max(2 × overhead, minBytes / 4)` 时）。JetBrains Mono 全部字符切成基础片 + 拉丁（含越南文）/ 希腊与西里尔 / 符号、制表符与盲文 / Powerline 图标；按字表取字的 CJK 场景切分与体积不变。
- 西文字体按文字分组分别校准连续码点压缩系数（`familyRunScales`）。JetBrains Mono 与 Fira Code 的分片总量估算偏差从 +43% 降到 ±5% 以内。
- "保留排版特性"额外保留 `ss01`–`ss20` 风格集与 `cv01`–`cv99` 字符变体；特性列表移到 `core/layout-features.ts`，字体卡片高亮会保留到输出的特性。不保留 `dlig`：它会让 Noto Sans SC 的基础片从 14 KB 变成 28 KB。
- 字体卡片按文字类型显示覆盖：西文字体为拉丁、拉丁扩展、希腊、西里尔、制表符、图标。覆盖范围的"推荐"标记改为跟随实际推荐档位（此前固定标在"常用"）。
- 删除"几乎不含汉字"的体检提示。
- `report.json` 新增 `homepage`、`characters.script` 与逐款式 `monospace` 字段（仍为 report@4，向后兼容）。
- 新增 JetBrains Mono 测试子集（OFL）、单元测试与 E2E 流程；`pnpm benchmark:planner` 支持 `western-common`、`western-full` 场景。

### 项目链接

- 页头加入 GitHub 源代码链接，页脚加入"开源于 GitHub"；生成包的 `README.md` 与 `report.json` 指向源代码仓库；`package.json` 补充 `homepage`、`repository` 与 `bugs`。

### 分包

- 新的规划器：页面正文被建模为从字频分布中抽样，分片的加载概率为 `1 − e^(−L·m)`；有字频依据的字符按概率降序排列，用动态规划求最小化"首访期望下载 + 请求成本 + 同一访客后续浏览的累计下载 + 每片 CSS 成本"的连续切分，单片大小受粒度档位约束。
- 长尾字符按码点顺序装箱：`unicode-range` 压缩为少量连续区间，相邻字形共享部件，压缩也更好。
- 粒度 1–7 一个滑杆，另有单文件模式。
- 基础字符（ASCII 与常用中西文标点）单独成片；基础片与加载概率 ≥ 90% 的分片建议预加载，最多 3 个文件。
- 可用字符相同的款式共享一套切分。
- 自定义文本达到 200 字后按长度混入字频（最多 40%），站点真实用字排进更靠前的分片。

### 体积模型

- 直接读取 glyf/loca、CFF/CFF2 CharStrings 与 gvar，得到每个字形的原始字节。
- 体检时用 4 次实测子集化校准：固定开销、压缩比例、连续码点系数、基础字符系数。整字体单文件另按幂律折减。
- 在 Noto Sans SC Variable、Noto Serif SC Variable 与等线上实测：分片总量估算偏差在 ±3.5% 内，每页期望下载与实测相差 −1%～+4%，单文件估算 −4%～+7%。
- "相比单文件"改用同一批字符打成单个文件的估算作为基准；此前使用分片之和，会高估收益。

### 字符范围

- 两个问题决定字符范围：语言（简体 / 繁体·台湾 / 繁体·香港，默认按字体覆盖与用户文本自动判断）和覆盖范围（仅文本 / 常用 / 完整 / 全部四档阶梯）。每一档实时显示字数、每页预计下载与文件数，并说明适合谁；界面直接给出博客的推荐做法："常用 + 粘贴文章"。
- 常用与完整两档自动附带拉丁字母、数字与中西文标点；用户文本里出现假名或谚文、且字体提供这些字形时，自动补入整套。
- "你的文本"显示被自动补入字表的生僻字；高级区放附加字符、`U+` 区间与 31 份标准字表库。
- 字频数据升级为 schema v2：新增经 OpenCC 映射派生的繁体档案；繁体语言自动使用。
- 几乎不含汉字的字体默认改为"全部"档（西文字体见上文）。

### 引擎

- 线程池：按字体体积与设备内存选择线程数（最多 6 个），每个线程只载入一次字体，所有分片并行生成；17 MB 的 Noto Sans SC Variable 生成 26 片约 1 秒。
- 子集化保留 `palt`、`vpal`、`halt`、`chws`、`kern`、`locl`、`vert` 及数字相关等网页常用布局特性，以及代码字体的 `ss01`–`ss20`、`cv01`–`cv99`；丢弃 DSIG/hdmx/LTSH/VDMX/PCLT。
- 精简 name 表（保留版权、字族、许可等记录）并重建 SFNT 校验和。
- 每片生成后经 `FontFace` 验证；取消会终止线程池并让在途体检重新排队。

### 输出

- 新 ZIP 结构：`fonts.css`、`fonts/*.woff2`、`preload.html`、`demo.html`、`report.json`（`webfont-slice/report@4`）、`README.md`。
- 文件名为 `<prefix>-<variant>-<index>.<hash>.woff2`，可设置一年期 immutable 缓存；前缀默认由字族名生成，可按字族自定义（如 `lxgw-400-87.f73f604a.woff2`）。
- 路径、font-display 只影响 CSS，在结果页改动即时更新代码与 ZIP，不需要重新生成。
- CSS 只声明本字体：不生成回退 `@font-face`、`local()`、ascent/descent/line-gap 覆盖，`font-family` 也不附加 `serif` / `sans-serif`。
- `demo.html` 通过 `PerformanceObserver` 显示浏览器实际请求的分片。
- 支持 File System Access API 的浏览器可以直接写入本地目录。

### 界面

- 新的单页工作台：只有"字体"与"字符"两个设置区块，右侧常驻计划面板；手机与平板上是可展开为底部抽屉的吸底条，抽屉里有完整的图表、指标和粒度滑杆。
- 计划面板：加载概率图（宽度为体积、高度为加载概率）、图下方固定的分片详情条（悬停、按住或方向键选中）、每页预计下载与请求数、相比单文件、常用字覆盖、分包方式与粒度滑杆；生成中逐片点亮。
- 提示气泡改为视口内固定定位，不再被容器裁切或飞出屏幕。
- 结果区：真实按需加载的试玩区，按输入文字列出浏览器实际请求的分片；代码片段、逐片明细。
- 新的设计 token、浅深两套配色（对比度 ≥ 4.5:1）、Lucide 图标；`Ctrl/⌘ + Enter` 生成、`Esc` 取消。
- 设置自动保存（自定义文本除外）；语言默认跟随浏览器。

### 架构

- 分层改为 core / app / engine / platform / ui / i18n：应用层不依赖任何第三方包，引擎与平台只实现 `app/ports` 接口；ESLint 规则与 42/10 项探针强制执行。
- 新增 `pnpm benchmark:planner`：用真实字体比较各分包方案，`--measure` 逐片实测估算误差。

### 移除（消融）

- 按数量、按大小两种分包方式及其二分重切；基础片开关（始终拆出）；字频依据选择器（由语言决定）；文件名模板与哈希开关；独立的"分包"与"输出"区块；度量对齐的回退字体及其开关，以及只为它服务的垂直度量读取与衬线检测。
- 旧的六步向导、11 个起点场景卡片、自定义安装提示、`report.html` 与 `README.txt`、`application/` 层、单 EngineSession 模型。
- 4 个旧基准脚本（memory / shards / variable / package），只保留 `benchmark:planner`。
- M8–M10 过程文档、`HANDOFF.md`、`designs/` 原型、`PLAN.md` 与 5 份并入 README / SHARDING / ARCHITECTURE / AGENTS 的文档（保留在 Git 历史中）。

## 1.x 后续加固（未单独发布，是 2.0.0 的起点）

> 本节记录 `1.1.0` 之后、2.0.0 重写之前的 A1–A3 加固、M9 界面与 M10 S1–S3 改动（提交 6beb243），没有单独发布。其中提到的 `application/` 层、单 EngineSession、M10 门禁与相关文档已在 2.0.0 中被替换。

### Security

- 上传改为先读取前四字节签名：不再信任扩展名或 MIME，TTC/OTC、未知签名和文件头读取失败按文件隔离，混合批次仍保留合法字体。
- 增加逐字体导出资格门禁；队列中任一字体待处理、处理中、失败、不支持或状态矛盾时阻止导出，只允许用户显式移除阻塞项，禁止静默跳过。
- 在文件读取、引擎 load/subset/reset、FontFace 验证和打包等异步边界补齐取消写屏障；迟到的进度、成功或错误不能覆盖新任务。
- WOFF1/WOFF2 在 decoder/WASM 前执行目录和解压预算：归一化及中间态上限 100 MB、最多 4095 张表、WOFF1 单表 1032 倍、WOFF2 100 倍、严格 transform version，并清零传给 decoder 私有副本中的 advisory `totalSfntSize`。
- 精确锁定 `fflate@0.8.3` 与 `wawoff2@2.0.1`；WASM 准备脚本在版本漂移时 fail closed。

### Added

- 新增可执行的 `architecture/source-layers` / `architecture/no-platform-globals` ESLint 规则、core 专用无平台 ambient typecheck 及 35 项拒绝、8 项允许探针，覆盖深层/折返路径、alias、动态/类型 import、`require`、三斜线引用、`src/core` browser/worker 运行时与纯类型全局、不会生成绑定的 `declare`/declaration merging/type-only import shadow、可执行 data 桥接，以及生产测试包泄漏；core 的 data 依赖精确收窄到生成的 `unicode-blocks.json`。
- 新增两列工作台、跨步骤常驻 `TaskRail` 和处理中移动端任务条；阻塞字体可在任务面板就地移除，`Esc` 可取消当前重型任务。
- 导出结果新增逐款式纯数值摘要、真实的原字体到 WOFF2 体积对比，以及可折叠逐片明细；多字体缺字不一致时显示逐字体结果。
- PWA 新增安装入口、离线状态、确定性 PNG/Maskable/Apple Touch 图标和显式更新提示；重型任务运行期间更新保持 pending，不提示、不自动刷新。
- 新增 `ServiceWorkerPort`、上传签名验证 use case、字体导出资格模型、共享字体体检契约和结果摘要纯函数。

### Changed

- `App.tsx` 保持唯一 composition root，并通过 ports 注入字符集、文本读取、复制、下载、FontFace 验证、打包和 Service Worker 能力；UI 不再直接依赖 platform/engine 实现。
- 重新体检只处理未完成或失败的字体；处理中保留最后一次可用工作区并锁定输入，成功、失败或取消都不丢失字符草稿与导出配置。
- 首屏改为克制的工具型布局，移除编造的效果数字、染色单字、特性勾选行和重复隐私声明；上传区在队列非空时收起。
- 视觉系统收敛为三层表面、三档圆角、统一微字号/眉标字距和成对浅深 token；界面文案遵循“说结果，不说实现”的双语术语公约。
- M10 S1 将获批 Direction A 的纸张/墨色/朱砂/青玉 token、3px 焦点环与近方形纸页映射到生产；页首改为紧凑品牌/隐私/偏好布局，六个业务步骤仅在展示层归并为四段任务线。
- Service Worker 从 `autoUpdate` 改为 `prompt`；版本刷新始终需要用户显式操作。
- 字体体检类型与报告从 engine 下沉到 core，subset RPC 与浏览器能力契约收敛到 application ports。

### Fixed

- 修复主题切换时颜色过渡中间态导致 axe 偶发读取无效对比度；切换期间通过 `data-theme-switching` 屏蔽全站过渡。
- 修复语言/主题变化触发 FontFace 或字符集数据重载、文本导入迟到回写、取消后旧任务进入新引擎等异步生命周期问题。
- 修复无刷新返回页首、长流程任务反馈、复制/下载状态语义、320 px 上传区溢出、焦点/标签/触控目标和结果面板可访问性问题。
- 修复 PWA 更新可能在长时间分包过程中自动重载并销毁本地工作的问题。
- 修复任务栏在体检或上传签名验证期间仍可点击移除阻塞字体；队列修改现在统一遵守全局控件锁定。
- 修复被接管的安装提示在手机端无可达入口且无法持久关闭；新增 320 px 安装、关闭与重载回归。
- 修复结果体积文案误把子集化后的总量差归因于按需加载，并移除 Hero 与原字体预览重复的隐私声明。

### Tests

- 当前质量基线为 38 个 Vitest 文件、162 项测试；V8 coverage 为 80.30% statements / 71.58% branches / 77.27% functions / 83.85% lines。
- Playwright 35/35 通过：Chromium 完整流程，以及 Firefox/WebKit 正式单包主流程；覆盖四段任务线、签名优先、恶意 WOFF 预算、门禁、取消/重试、状态保留、变量款式、PWA 安装持久关闭、axe 和 320/375 px。
- 四项引擎/打包脚本与生产构建已复验；最新可复现数字见 `docs/PERFORMANCE.md`。

### Documentation

- 将跨 Agent 约束统一到 `AGENTS.md`，保留最小 `CLAUDE.md` 兼容入口，并新增 `HANDOFF.md` 工程交接文档。
- 更新架构、实施状态、M9 执行偏差和性能基线，使文档与当前未发布工作树一致。
- 建立 M10 UI/UX v2 的现状审计、需求矩阵、redesign brief、决策日志与原型先行 G0–G3 门禁；完成三方向探索，选择 Direction A，并批准 `prototype-v1`、实施计划与 parity matrix。S1 已完成并同步 parity/架构证据；S2–S6 的依赖、状态拥有者、测试包与退出证据已准备，生产实现仍停在 S2 前。

## 1.1.0 — 2026-07-24

### Changed

- 使用 workflow reducer、revision 与单调 task token 统一体检和导出状态；取消后不接受迟到结果。
- 所有字体顺序复用一个可终止、懒重建的 `EngineSession`，体检数据不再持有 Worker。
- 将字符意图与逐 Face cmap 分析分离；report schema v3 记录每个输出款式的完整缺字、变量模式与轴坐标。
- 正式导出支持逐 Face 启用、字族、字重和 normal/italic/oblique 映射及坐标预检。
- ZIP 在短生命周期 Worker 中生成；输入/config/语言变化会立即使旧结果失效。
- WOFF1 改为规范级逐表解包，移除 `fonteditor-core`，保留 WOFF-CFF、GDEF/GPOS/GSUB 等表。
- 可变字体体检展示 `fvar` 轴、全部 named instances 与普通部署候选；正式导出可保留 weight/stretch 范围，或多选固定款式并移除变体表。
- 同一变量源的多个固定款式只加载一次；轴坐标进入预检、任务快照、实际大小重切、FontFace 验证、文件名和报告。
- HTML 导入只保留可见文本并限制 5 MB；字符集和字频加载失败可重试。
- 完整加固 CSS string、HTML attribute、URL 前缀和 ZIP 重名边界。
- 字表来源统一为公开 HTTP(S) 地址，不再在运行时界面链接仓库内 Markdown；同时展示固定版本与处理说明。
- Step 03 明确预设并集、自定义叠加和重叠去重；仅自定义只暂停预设，模板状态、搜索外已选项和贡献统计均可见。
- 字符意图不再包含分片策略；最小字符集不会暗中锁定下一步为单包。
- 拆分 App、字符集和导出大组件，新增 `app/application/platform` 分层。

### Tests

- 增加应用服务取消、多字体、dirty result、输出注入、WOFF-CFF、变量 preserve/static、多固定款式、Step 03 交互和异步打包测试。
- 启用 V8 coverage 阈值；Playwright 强制测试最新构建并覆盖 Chromium、Firefox、WebKit。

## 1.0.0 — 2026-07-24

首个完整静态版本。

### Added

- 浏览器本地 TTF/OTF/WOFF/WOFF2 体检、原字体预览、多字体家族/字重映射。
- Unicode 17.0.0 的 346 区块覆盖与完整 JSON/cmap 导出。
- 31 份简体、繁体、Unicode 与功能字符集；模板、自定义文本/文件、`U+` 区间、缺字导出。
- 可增长内存 HarfBuzz 10.4 WASM、WOFF1 归一化和 WOFF2 编解码。
- 字频基础包、每片字符数/目标片数/目标体积/整包四种策略。
- 多字重 CSS、文件名模板、URL 前缀、preload、report、demo 和 ZIP。
- 逐片进度、取消并重建 Worker、FontFace 验证与内存释放。
- 中英文核心界面、系统/浅色/深色主题、PWA 离线支持。
- axe 可访问性、375px 窄屏、全链路 Playwright 和许可明确的字体夹具。
