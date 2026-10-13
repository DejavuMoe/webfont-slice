# 字表与字频数据

## 字表

`public/charsets/index.json` 注册 31 个预设。每份 JSON 使用升序、不重叠的闭区间 `[[start, end], …]`，`expectedCount` 是展开后的唯一码点数；加载时严格校验区间与计数。

| 类别          | 内容                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `simplified`  | 通用规范汉字表 2013（一级/一二级/全表）、1988 旧字表、GB 2312、GBK、GB 18030-2022 实现级别 1/2 |
| `traditional` | Big5 常用/全部、台湾常用/次常用國字、香港常用字字形表、HKSCS-2016                              |
| `unicode`     | CJK 基本区与扩展区、标点、全半角、假名、谚文等区块                                             |
| `functional`  | ASCII、Latin-1、拼音拉丁扩展、数字、中西文标点与常用符号                                       |

界面把它们组织为"语言 × 覆盖范围 + 高级"（`src/core/character-settings.ts`）：

| 语言        | 常用                       | 完整                |
| ----------- | -------------------------- | ------------------- |
| 简体        | 通规一级 3,500             | 通规全表 8,105      |
| 繁体 · 台湾 | 教育部常用国字 + Big5 常用 | Big5 全部汉字       |
| 繁体 · 香港 | 香港常用字字形表           | 常用字 + HKSCS-2016 |

- 常用与完整两档自动附带 ASCII、中西文标点与中文数字（`BASE_PRESET_IDS`）；"仅文本"只用用户文本，"全部"用字体 cmap。
- 高级设置里的附加字符：常用符号、Latin-1、拼音声调、全角字母、假名、谚文；用户文本含假名/谚文且字体提供这些字形时自动补整套。
- 字表库可以再勾选任意标准字表（GB 2312、GBK、GB 18030、1988 旧字表、次常用国字等）。

字表只决定保留哪些码点，不保证字体字形符合某地标准字形。

### 来源

构建源快照、固定上游 revision 与许可见 [`tools/charset-sources/README.md`](../tools/charset-sources/README.md)。生成后的每份预设也包含 `standard / source / sourceRevision / license`；`source` 必须是可以从静态站直接打开的绝对 HTTPS URL。

重要计数：

- 通用规范汉字表：3500 / 6500 / 8105。
- GB 2312：6763 汉字；CP936/GBK 映射：20923 个唯一汉字。
- GB 18030-2022 级别 1：CJK 基本区 + 扩展 A，共 27584 个码点；级别 2 再含通规表 196 个辅助平面字，共 27780。
- Big5：5401 / 13053。
- 台湾常用 4808；次常用官方 6341 条，去重后 6339。
- 香港常用字 4762 条含异体，展开后 4825；HKSCS-2016 共 5033 个码点。

## 字频

`public/freq/han-freq.json`（schema v2）由 `pnpm frequency:build` 生成：

```jsonc
{
  "version": 2,
  "source": "SUBTLEX-CH-CHR …",
  "hantDerivation": "OpenCC STCharacters.txt + TWVariants.txt …",
  "corpusTotal": 46841097,
  "profiles": {
    "hans": { "chars": "的一是不了…", "counts": [/* 与 chars 一一对应 */] },
    "hant": { "chars": "…", "counts": [/* … */] },
  },
}
```

- `hans`：SUBTLEX-CH-CHR（Cai & Brysbaert, 2010）字符频次，5936 字，来自 MIT 许可的 `subtlex-ch-chr` 分发包。
- `hant`：没有同等规模的开放繁体字频表，因此由 `hans` 派生：按 OpenCC `STCharacters.txt` 把每个简体字的频次转给对应繁体字（一对多时首选字形继承 85%，其余候选均分 15%；简繁同形字保持原值），再按 `TWVariants.txt` 映射为台湾常用字形，得到 5775 字。OpenCC 数据为 Apache-2.0，快照固定在 `tools/charset-sources/opencc/`（BYVoid/OpenCC@178f05d）。

用途：

1. 分包规划的字符使用概率（`src/core/frequency.ts` 的 `createUsageModel`）；
2. 每页期望下载量与"常用字频次覆盖"指标；
3. 自定义文本达到 200 字后按长度混入用户字频，最多占 40%，让站点真实用字排进更靠前的分片。

语料外字符赋予极小的平滑概率，按码点顺序进入长尾分片。

## 维护命令

```bash
pnpm charsets:build && pnpm charsets:verify
pnpm frequency:build && pnpm frequency:verify
pnpm unicode-blocks:build && pnpm unicode-blocks:verify
```

新增字表必须：

1. 把可复现的源快照放到 `tools/charset-sources/`，记录机构、年份、URL、revision 和许可；
2. 在生成脚本中硬校验官方条目数和唯一码点数；
3. 注册到索引，必要时加入 `src/core/character-settings.ts` 的档位映射；
4. 更新 `NOTICE`、本文和测试；
5. `pnpm check` 全绿。
