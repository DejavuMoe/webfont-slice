import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRECTORY = path.join(ROOT, 'public/charsets');
const MAX_CODE_POINT = 0x10ffff;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;

function fail(fileName, message) {
  throw new Error(`${fileName}: ${message}`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isScalarValue(value) {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_CODE_POINT &&
    (value < SURROGATE_START || value > SURROGATE_END)
  );
}

function verifyPreset(fileName, value) {
  if (!isRecord(value)) fail(fileName, '顶层必须是对象');
  if (typeof value.id !== 'string' || `${value.id}.json` !== fileName) {
    fail(fileName, 'id 必须与文件名一致');
  }
  if (typeof value.name !== 'string' || value.name.length === 0) fail(fileName, '缺少名称');
  if (!['simplified', 'traditional', 'unicode', 'functional'].includes(value.category)) {
    fail(fileName, 'category 不在允许范围内');
  }
  for (const field of ['standard', 'source', 'license', 'description']) {
    if (typeof value[field] !== 'string' || value[field].length === 0) {
      fail(fileName, `缺少 ${field}`);
    }
  }
  try {
    const sourceUrl = new URL(value.source);
    if (!['http:', 'https:'].includes(sourceUrl.protocol)) {
      fail(fileName, 'source 只允许绝对 HTTP(S) URL');
    }
  } catch {
    fail(fileName, 'source 必须是可公开访问的绝对 URL，不能引用仓库内 Markdown');
  }
  if (
    value.officialEntryCount !== undefined &&
    (!Number.isInteger(value.officialEntryCount) || value.officialEntryCount <= 0)
  ) {
    fail(fileName, 'officialEntryCount 必须是正整数');
  }
  if (!Number.isInteger(value.expectedCount) || value.expectedCount < 0) {
    fail(fileName, 'expectedCount 必须是非负整数');
  }
  if (!Array.isArray(value.ranges)) fail(fileName, 'ranges 必须是数组');

  let previousEnd = -1;
  let actualCount = 0;

  for (const [index, range] of value.ranges.entries()) {
    if (!Array.isArray(range) || range.length !== 2) fail(fileName, `ranges[${index}] 格式错误`);
    const [start, end] = range;
    if (!isScalarValue(start) || !isScalarValue(end)) {
      fail(fileName, `ranges[${index}] 包含无效 Unicode 码点`);
    }
    if (start > end) fail(fileName, `ranges[${index}] 起点大于终点`);
    if (start <= previousEnd) fail(fileName, `ranges[${index}] 未升序排列或存在重叠`);
    if (start <= SURROGATE_START && end >= SURROGATE_END) {
      fail(fileName, `ranges[${index}] 跨越 UTF-16 代理项`);
    }
    previousEnd = end;
    actualCount += end - start + 1;
  }

  if (actualCount !== value.expectedCount) {
    fail(fileName, `展开字数 ${actualCount} 与 expectedCount ${value.expectedCount} 不一致`);
  }

  return { id: value.id, expectedCount: value.expectedCount };
}

const REQUIRED_PRESET_IDS = [
  'sc-tgh-1',
  'sc-tgh-12',
  'sc-tgh-full',
  'sc-xdhy-3500',
  'sc-xdhy-7000',
  'sc-gb2312',
  'sc-gbk',
  'sc-gb18030-l1',
  'sc-gb18030-l2',
  'tc-big5-common',
  'tc-big5-full',
  'tc-moe-common',
  'tc-moe-less',
  'tc-hk-common',
  'tc-hkscs',
  'u-cjk-basic',
  'u-cjk-ext-a',
  'f-latin-ascii',
  'f-punct-cn',
];

const entries = (await readdir(DIRECTORY)).filter(
  (fileName) => fileName.endsWith('.json') && fileName !== 'index.json',
);
if (entries.length === 0) throw new Error('没有可校验的字符集数据，请先运行 pnpm charsets:build');

const verified = new Map();
for (const fileName of entries.sort()) {
  const value = JSON.parse(await readFile(path.join(DIRECTORY, fileName), 'utf8'));
  const result = verifyPreset(fileName, value);
  if (verified.has(result.id)) fail(fileName, `重复 id：${result.id}`);
  verified.set(result.id, result.expectedCount);
}

const index = JSON.parse(await readFile(path.join(DIRECTORY, 'index.json'), 'utf8'));
if (!isRecord(index) || !Array.isArray(index.presets)) fail('index.json', 'presets 必须是数组');
const indexedIds = new Set(
  index.presets.map((preset) => (isRecord(preset) ? preset.id : undefined)),
);
for (const id of verified.keys()) {
  if (!indexedIds.has(id)) fail('index.json', `缺少 ${id}`);
}
if (indexedIds.size !== verified.size) fail('index.json', '索引与字符集文件数量不一致');
for (const id of REQUIRED_PRESET_IDS) {
  if (!verified.has(id)) fail('index.json', `缺少 PLAN.md 要求的预设 ${id}`);
}

const totalCodePoints = [...verified.values()].reduce((total, count) => total + count, 0);
console.log(
  `字符集校验通过：${verified.size} 份数据，共 ${totalCodePoints.toLocaleString('zh-CN')} 个区间展开码点。`,
);
