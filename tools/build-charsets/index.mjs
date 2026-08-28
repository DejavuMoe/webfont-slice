import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_DIRECTORY = path.join(ROOT, 'public/charsets');
const SOURCE_DIRECTORY = path.join(ROOT, 'tools/charset-sources');
const UNICODE_BLOCKS_SOURCE = 'https://www.unicode.org/Public/17.0.0/ucd/Blocks.txt';
const UNICODE_DATA_SOURCE = 'https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt';

function codePointsFromText(text) {
  return [...new Set([...text].map((character) => character.codePointAt(0)))];
}

function isHan(codePoint) {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x323af)
  );
}

function compress(codePoints) {
  const sorted = [...new Set(codePoints)].sort((left, right) => left - right);
  if (sorted.length === 0) return [];

  const ranges = [];
  let start = sorted[0];
  let end = start;

  for (const codePoint of sorted.slice(1)) {
    if (codePoint === end + 1) {
      end = codePoint;
    } else {
      ranges.push([start, end]);
      start = codePoint;
      end = codePoint;
    }
  }
  ranges.push([start, end]);
  return ranges;
}

function countRanges(ranges) {
  return ranges.reduce((total, [start, end]) => total + end - start + 1, 0);
}

function assertCount(id, codePoints, expected) {
  const actual = new Set(codePoints).size;
  if (actual !== expected) {
    throw new Error(`${id} 唯一码点数应为 ${expected}，实际为 ${actual}`);
  }
}

const rangePreset = (id, name, range, description) => ({
  id,
  name,
  category: id.startsWith('f-') ? 'functional' : 'unicode',
  standard: 'Unicode 17.0.0 Blocks',
  source: UNICODE_BLOCKS_SOURCE,
  license: 'Unicode Terms of Use',
  description,
  ranges: [range],
});

const functionalPreset = (id, name, text, description) => ({
  id,
  name,
  category: 'functional',
  standard: '项目功能分类（依据 Unicode 码点整理）',
  source: UNICODE_DATA_SOURCE,
  sourceRevision: 'WebFont Slice 项目维护的 Unicode 17.0.0 事实性码点选择',
  license: '项目码点选择采用 MIT；Unicode 参考数据适用 Unicode Terms of Use',
  description,
  ranges: compress(codePointsFromText(text)),
});

function standardPreset({
  id,
  name,
  category,
  standard,
  source,
  sourceRevision,
  license,
  description,
  codePoints,
  expectedCount,
  officialEntryCount,
}) {
  assertCount(id, codePoints, expectedCount);
  return {
    id,
    name,
    category,
    standard,
    source,
    sourceRevision,
    license,
    description,
    expectedCount,
    ...(officialEntryCount === undefined ? {} : { officialEntryCount }),
    ranges: compress(codePoints),
  };
}

async function loadTgh() {
  const text = await readFile(path.join(SOURCE_DIRECTORY, 'tgh-2013/raw.csv'), 'utf8');
  const entries = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => {
      const fields = line.split(',');
      return { character: fields[1], level: Number(fields[5]) };
    });
  if (entries.some((entry) => entry.character === undefined || ![1, 2, 3].includes(entry.level))) {
    throw new Error('通用规范汉字表源文件格式错误');
  }
  return entries;
}

async function loadModernList(fileName, expectedCount) {
  const text = await readFile(path.join(SOURCE_DIRECTORY, 'modern-1988', fileName), 'utf8');
  const codePoints = text
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => line.trim().codePointAt(0));
  assertCount(fileName, codePoints, expectedCount);
  return codePoints;
}

async function loadTaiwanList(fileName, expectedCount) {
  const text = await readFile(path.join(SOURCE_DIRECTORY, 'taiwan', fileName), 'utf8');
  const codePoints = [...text.split(/\r?\n/u).slice(2).join('')]
    .map((character) => character.codePointAt(0))
    .filter(isHan);
  assertCount(fileName, codePoints, expectedCount);
  return codePoints;
}

async function loadMapping(fileName) {
  const text = await readFile(path.join(SOURCE_DIRECTORY, 'mappings', fileName), 'utf8');
  const entries = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^0x([\dA-F]+)\s+0x([\dA-F]+)/u.exec(line);
    if (match === null) continue;
    entries.push({
      encoded: Number.parseInt(match[1], 16),
      unicode: Number.parseInt(match[2], 16),
    });
  }
  return entries;
}

async function standardPresets() {
  const [tgh, modern3500, modern7000, taiwanCommon, taiwanLess, cp936, cp950, hkJson, hkscs] =
    await Promise.all([
      loadTgh(),
      loadModernList('normal_hanzi_3500.text', 3500),
      loadModernList('basic_hanzi_7000.text', 7000),
      loadTaiwanList('zhangyong1979.txt', 4808),
      loadTaiwanList('cizhangyong1982.txt', 6339),
      loadMapping('CP936.TXT'),
      loadMapping('CP950.TXT'),
      readFile(path.join(SOURCE_DIRECTORY, 'hong-kong/common-graphemes.json'), 'utf8'),
      readFile(path.join(SOURCE_DIRECTORY, 'hong-kong/HKSCS2016.tsv'), 'utf8'),
    ]);

  const tghLevel1 = tgh
    .filter((entry) => entry.level === 1)
    .map((entry) => entry.character.codePointAt(0));
  const tghLevel12 = tgh
    .filter((entry) => entry.level <= 2)
    .map((entry) => entry.character.codePointAt(0));
  const tghFull = tgh.map((entry) => entry.character.codePointAt(0));
  const gb2312 = cp936
    .filter(
      ({ encoded, unicode }) =>
        encoded >= 0xb0a1 && encoded <= 0xf7fe && (encoded & 0xff) >= 0xa1 && isHan(unicode),
    )
    .map(({ unicode }) => unicode);
  const gbk = cp936
    .filter(({ encoded, unicode }) => encoded >= 0x8140 && isHan(unicode))
    .map(({ unicode }) => unicode);
  const big5Common = cp950
    .filter(
      ({ encoded, unicode }) =>
        encoded >= 0xa440 && encoded <= 0xc67e && (encoded & 0xff) !== 0x7f && isHan(unicode),
    )
    .map(({ unicode }) => unicode);
  const big5Full = cp950
    .filter(
      ({ encoded, unicode }) =>
        encoded >= 0xa440 && encoded <= 0xf9d5 && (encoded & 0xff) !== 0x7f && isHan(unicode),
    )
    .map(({ unicode }) => unicode);
  const gb18030Level1 = [
    ...Array.from({ length: 0x4dc0 - 0x3400 }, (_, index) => 0x3400 + index),
    ...Array.from({ length: 0xa000 - 0x4e00 }, (_, index) => 0x4e00 + index),
  ];
  const gb18030Level2 = [...gb18030Level1, ...tghFull];

  const hkEntries = JSON.parse(hkJson);
  const hkCommon = hkEntries.flatMap((entry) =>
    (Array.isArray(entry) ? entry : [entry]).flatMap((text) => codePointsFromText(text)),
  );
  const hkscsCodePoints = hkscs
    .trim()
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => Number.parseInt(line.split('\t')[0], 16));

  const tghSource = 'https://www.gov.cn/zhengce/content/2013-08/19/content_1289.htm';
  const tghRevision = '社区数字化校验快照 chenny/General-Chinese-Characters-Table-Pro@579687e';
  const modernSource = 'https://github.com/quanh/chinese-char-dict/tree/97b5d4f/hanzi1988';
  const taiwanSource = 'https://github.com/cjkvi/cjkvi-tables/tree/096c255';
  const unicodeMappingSource = 'https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/';

  return [
    standardPreset({
      id: 'sc-tgh-1',
      name: '通用规范汉字表 · 一级',
      category: 'simplified',
      standard: '《通用规范汉字表》（2013）一级字表',
      source: tghSource,
      sourceRevision: tghRevision,
      license: '上游数字化数据 MIT；标准事实数据',
      description: '3500 个一级常用规范汉字，中文博客与日常写作首选',
      codePoints: tghLevel1,
      expectedCount: 3500,
    }),
    standardPreset({
      id: 'sc-tgh-12',
      name: '通用规范汉字表 · 一级+二级',
      category: 'simplified',
      standard: '《通用规范汉字表》（2013）一级、二级字表',
      source: tghSource,
      sourceRevision: tghRevision,
      license: '上游数字化数据 MIT；标准事实数据',
      description: '一级 3500 + 二级 3000，适合新闻、教育和一般出版',
      codePoints: tghLevel12,
      expectedCount: 6500,
    }),
    standardPreset({
      id: 'sc-tgh-full',
      name: '通用规范汉字表 · 全表',
      category: 'simplified',
      standard: '《通用规范汉字表》（2013）',
      source: tghSource,
      sourceRevision: tghRevision,
      license: '上游数字化数据 MIT；标准事实数据',
      description: '一级、二级、三级共 8105 字，含 196 个辅助平面汉字',
      codePoints: tghFull,
      expectedCount: 8105,
    }),
    standardPreset({
      id: 'sc-xdhy-3500',
      name: '现代汉语常用字表（1988）',
      category: 'simplified',
      standard: '《现代汉语常用字表》（1988）',
      source: modernSource,
      sourceRevision: 'quanh/chinese-char-dict@97b5d4f',
      license: '标准事实数据；社区数字化快照',
      description: '常用 2500 + 次常用 1000；旧版留存，新增项目优先选通规一级',
      codePoints: modern3500,
      expectedCount: 3500,
    }),
    standardPreset({
      id: 'sc-xdhy-7000',
      name: '现代汉语通用字表（1988）',
      category: 'simplified',
      standard: '《现代汉语通用字表》（1988）',
      source: modernSource,
      sourceRevision: 'quanh/chinese-char-dict@97b5d4f',
      license: '标准事实数据；社区数字化快照',
      description: '7000 个通用汉字；旧版留存，新增项目优先选通规表',
      codePoints: modern7000,
      expectedCount: 7000,
    }),
    standardPreset({
      id: 'sc-gb2312',
      name: 'GB 2312-80 汉字',
      category: 'simplified',
      standard: 'GB 2312-80',
      source: unicodeMappingSource,
      sourceRevision: 'Unicode CP936.TXT',
      license: 'Unicode Terms of Use',
      description: '按 GB 2312 汉字编码区提取，兼容旧系统',
      codePoints: gb2312,
      expectedCount: 6763,
    }),
    standardPreset({
      id: 'sc-gbk',
      name: 'GBK / CP936 汉字映射',
      category: 'simplified',
      standard: 'GBK 1.0 / Windows CP936 Unicode 映射',
      source: unicodeMappingSource,
      sourceRevision: 'Unicode CP936.TXT',
      license: 'Unicode Terms of Use',
      description: 'CP936 映射中 20923 个唯一汉字码点（不含符号）',
      codePoints: gbk,
      expectedCount: 20923,
    }),
    standardPreset({
      id: 'sc-gb18030-l1',
      name: 'GB 18030-2022 · 实现级别 1',
      category: 'simplified',
      standard: 'GB 18030-2022 实现级别 1',
      source: 'https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=12B9D55A5DF31A1CF010B7E0A87B4DC8',
      sourceRevision: 'CJK 基本区 + 扩展 A 范围',
      license: '标准事实数据',
      description: '级别 1 要求支持 CJK 基本区和扩展 A；范围很大，请按需使用',
      codePoints: gb18030Level1,
      expectedCount: 27584,
    }),
    standardPreset({
      id: 'sc-gb18030-l2',
      name: 'GB 18030-2022 · 实现级别 2',
      category: 'simplified',
      standard: 'GB 18030-2022 实现级别 2',
      source: 'https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=12B9D55A5DF31A1CF010B7E0A87B4DC8',
      sourceRevision: '级别 1 + 通用规范汉字表中辅助平面字符',
      license: '标准事实数据',
      description: '系统软件合规场景；级别 1 加通规表中 196 个辅助平面汉字',
      codePoints: gb18030Level2,
      expectedCount: 27780,
    }),
    standardPreset({
      id: 'tc-big5-common',
      name: 'Big5 常用字',
      category: 'traditional',
      standard: 'Big5 第一字面（常用字）',
      source: unicodeMappingSource,
      sourceRevision: 'Unicode CP950.TXT，编码 A440–C67E',
      license: 'Unicode Terms of Use',
      description: 'Big5 第一字面 5401 个常用繁体汉字',
      codePoints: big5Common,
      expectedCount: 5401,
    }),
    standardPreset({
      id: 'tc-big5-full',
      name: 'Big5 全部汉字',
      category: 'traditional',
      standard: 'Big5 常用+次常用字',
      source: unicodeMappingSource,
      sourceRevision: 'Unicode CP950.TXT，编码 A440–F9D5',
      license: 'Unicode Terms of Use',
      description: 'Big5 两个字面共 13053 个唯一汉字',
      codePoints: big5Full,
      expectedCount: 13053,
    }),
    standardPreset({
      id: 'tc-moe-common',
      name: '常用國字標準字體表',
      category: 'traditional',
      standard: '台湾教育部《常用國字標準字體表》（1979）',
      source: taiwanSource,
      sourceRevision: 'cjkvi/cjkvi-tables@096c255',
      license: '标准事实数据；社区数字化快照',
      description: '台湾教育与出版常用 4808 字；字符集不保证上传字体的字形合规',
      codePoints: taiwanCommon,
      expectedCount: 4808,
    }),
    standardPreset({
      id: 'tc-moe-less',
      name: '次常用國字標準字體表',
      category: 'traditional',
      standard: '台湾教育部《次常用國字標準字體表》（1982）',
      source: taiwanSource,
      sourceRevision: 'cjkvi/cjkvi-tables@096c255',
      license: '标准事实数据；社区数字化快照',
      description: '官方表 6341 条，去除两个重复字符后为 6339 个唯一码点',
      codePoints: taiwanLess,
      expectedCount: 6339,
      officialEntryCount: 6341,
    }),
    standardPreset({
      id: 'tc-hk-common',
      name: '香港常用字字形表',
      category: 'traditional',
      standard: '《常用字字形表》（2000 修订本）',
      source:
        'https://github.com/leonsilicon/list-of-graphemes-of-commonly-used-chinese-characters',
      sourceRevision: '07f649a；4762 条，包含同序异体',
      license: 'MIT；依据香港教育学院出版物数字化',
      description: '4762 条表项展开同序异体后为 4825 个唯一码点',
      codePoints: hkCommon,
      expectedCount: 4825,
      officialEntryCount: 4762,
    }),
    standardPreset({
      id: 'tc-hkscs',
      name: '香港增補字符集 HKSCS-2016',
      category: 'traditional',
      standard: 'HKSCS-2016',
      source:
        'https://data.gov.hk/en-data/dataset/hk-dpo-dpo_hp-hong-kong-supplementary-character-set-related-information',
      sourceRevision: 'yawnoc/hkscs-2016@1c5900f',
      license: '香港政府开放数据；格式转换快照',
      description: '5033 个码点（其中约 4606 个汉字），涵盖粤语、地名和人名用字',
      codePoints: hkscsCodePoints,
      expectedCount: 5033,
    }),
  ];
}

const basePresets = [
  rangePreset('u-cjk-basic', 'CJK 统一表意文字（基本集）', [0x4e00, 0x9fff], 'CJK 基本汉字区块'),
  rangePreset('u-cjk-ext-a', 'CJK 扩展 A', [0x3400, 0x4dbf], 'CJK Unified Ideographs Extension A'),
  rangePreset('u-cjk-ext-bf', 'CJK 扩展 B–F', [0x20000, 0x2ebef], '大字符集范围，使用时需注意体积'),
  rangePreset('u-cjk-compat', 'CJK 兼容表意文字', [0xf900, 0xfaff], 'CJK Compatibility Ideographs'),
  rangePreset('u-cjk-punct', 'CJK 符号与标点', [0x3000, 0x303f], 'CJK Symbols and Punctuation'),
  rangePreset('u-fullwidth', '全角与半角形式', [0xff00, 0xffef], 'Halfwidth and Fullwidth Forms'),
  rangePreset('u-kana', '平假名与片假名', [0x3040, 0x30ff], 'Hiragana 与 Katakana 基础区间'),
  rangePreset('u-hangul', '谚文音节', [0xac00, 0xd7af], 'Hangul Syllables'),
  rangePreset('u-general-punct', '西文广义标点', [0x2000, 0x206f], 'General Punctuation'),
  rangePreset('f-latin-ascii', 'ASCII', [0x20, 0x7e], '可打印 ASCII，包含半角数字与标点'),
  rangePreset('f-latin-1', 'Latin-1 补充', [0x00a0, 0x00ff], 'Latin-1 Supplement'),
  rangePreset(
    'f-latin-ext-a',
    '拉丁扩展 A',
    [0x0100, 0x017f],
    'Latin Extended-A，包含拼音带调字母',
  ),
  functionalPreset(
    'f-digits-cjk',
    '中文数字与序号',
    '〇一二三四五六七八九十百千万亿①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥',
    '中文数字、带圈数字一至二十与干支',
  ),
  functionalPreset(
    'f-punct-cn',
    '常用中文标点',
    '。，、；：？！…—·「」『』《》（）【】〔〕～％',
    '常用中文标点显式清单',
  ),
  functionalPreset('f-punct-west', '常用西文标点', '“”‘’–—…•‹›«»', 'General Punctuation 常用子集'),
  functionalPreset(
    'f-symbols',
    '常用符号',
    '¥$€£←↑→↓↔↕±×÷≈≤≥≠∞©®™',
    '常用货币、箭头、数学与版权符号',
  ),
];

const presets = [...basePresets, ...(await standardPresets())];

await mkdir(OUTPUT_DIRECTORY, { recursive: true });
for (const entry of await readdir(OUTPUT_DIRECTORY)) {
  if (entry.endsWith('.json')) await rm(path.join(OUTPUT_DIRECTORY, entry));
}

const index = [];
for (const preset of presets) {
  const output = {
    ...preset,
    expectedCount: preset.expectedCount ?? countRanges(preset.ranges),
  };
  await writeFile(
    path.join(OUTPUT_DIRECTORY, `${preset.id}.json`),
    `${JSON.stringify(output)}\n`,
    'utf8',
  );
  index.push({
    id: output.id,
    name: output.name,
    category: output.category,
    expectedCount: output.expectedCount,
    ...(output.officialEntryCount === undefined
      ? {}
      : { officialEntryCount: output.officialEntryCount }),
    standard: output.standard,
    description: output.description,
  });
}

await writeFile(
  path.join(OUTPUT_DIRECTORY, 'index.json'),
  `${JSON.stringify({ version: 2, generatedFrom: 'tools/charset-sources', presets: index }, null, 2)}\n`,
  'utf8',
);

console.log(`已生成 ${presets.length} 份字符集数据：${path.relative(ROOT, OUTPUT_DIRECTORY)}`);
