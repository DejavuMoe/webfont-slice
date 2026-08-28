/**
 * 生成 public/freq/han-freq.json（schema v2）。
 *
 * - hans：SUBTLEX-CH-CHR 原始字频（简体语料）。
 * - hant：同一语料经 OpenCC STCharacters 简→繁映射推导的近似繁体字频。
 *   一对多映射时主形继承 85% 频次，其余候选均分 15%；简繁同形字保持原值。
 *
 * 输出使用紧凑结构：chars 为按频次降序排列的字符串，counts 为对应计数。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subtlex from 'subtlex-ch-chr';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'public/freq/han-freq.json');
const OPENCC = path.join(ROOT, 'tools/charset-sources/opencc/STCharacters.txt');
const OPENCC_TW = path.join(ROOT, 'tools/charset-sources/opencc/TWVariants.txt');
const checkOnly = process.argv.includes('--check');

const PRIMARY_SHARE = 0.85;

function sortEntries(map) {
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0] - right[0]);
}

function toProfile(entries) {
  return {
    chars: entries.map(([codePoint]) => String.fromCodePoint(codePoint)).join(''),
    counts: entries.map(([, count]) => count),
  };
}

const hans = new Map();
for (const row of subtlex.data) {
  const characters = [...row.Character];
  if (characters.length !== 1 || !Number.isInteger(row.CHRCount) || row.CHRCount <= 0) continue;
  const codePoint = characters[0].codePointAt(0);
  if (codePoint === undefined) continue;
  if (hans.has(codePoint)) throw new Error(`SUBTLEX-CH-CHR 包含重复字符 ${characters[0]}`);
  hans.set(codePoint, row.CHRCount);
}

const mapping = new Map();
for (const line of (await readFile(OPENCC, 'utf8')).split('\n')) {
  if (line.length === 0 || line.startsWith('#')) continue;
  const [key, value] = line.split('\t');
  const source = [...(key ?? '')];
  const targets = (value ?? '').trim().split(/\s+/u).filter(Boolean);
  if (source.length !== 1 || targets.length === 0) throw new Error(`OpenCC 行格式无效：${line}`);
  mapping.set(
    source[0].codePointAt(0),
    targets.map((target) => target.codePointAt(0)),
  );
}
if (mapping.size < 3900) throw new Error(`OpenCC STCharacters 条目过少：${mapping.size}`);

const hant = new Map();
const add = (codePoint, count) => hant.set(codePoint, (hant.get(codePoint) ?? 0) + count);
for (const [codePoint, count] of hans) {
  const targets = mapping.get(codePoint);
  if (targets === undefined) {
    add(codePoint, count);
    continue;
  }
  const [primary, ...alternatives] = targets;
  if (alternatives.length === 0) {
    add(primary, count);
    continue;
  }
  add(primary, Math.round(count * PRIMARY_SHARE));
  const share = Math.round((count * (1 - PRIMARY_SHARE)) / alternatives.length);
  for (const alternative of alternatives) add(alternative, share);
}

// 台湾通行字形（爲→為、裏→裡等）：一对一变体整体转移频次，保持与台湾字表一致。
for (const line of (await readFile(OPENCC_TW, 'utf8')).split('\n')) {
  if (line.length === 0 || line.startsWith('#')) continue;
  const [key, value] = line.split('\t');
  const source = [...(key ?? '')];
  const targets = (value ?? '').trim().split(/\s+/u).filter(Boolean);
  if (source.length !== 1 || targets.length !== 1) continue;
  const from = source[0].codePointAt(0);
  const to = targets[0].codePointAt(0);
  const count = hant.get(from);
  if (from === to || count === undefined) continue;
  hant.delete(from);
  add(to, count);
}

const hansEntries = sortEntries(hans);
const hantEntries = sortEntries(hant);

const output = {
  version: 2,
  source: 'SUBTLEX-CH-CHR: Character frequencies based on film subtitles (Cai & Brysbaert, 2010)',
  package: 'subtlex-ch-chr@0.0.0 (MIT JSON distribution)',
  sourceUrl: 'https://github.com/leonsilicon/subtlex-ch-chr',
  hantDerivation:
    'OpenCC STCharacters.txt + TWVariants.txt (Apache-2.0, BYVoid/OpenCC@178f05d) simplified→traditional mapping; primary form 85%',
  corpusTotal: subtlex.metadata.totalCharacterCount,
  profiles: {
    hans: toProfile(hansEntries),
    hant: toProfile(hantEntries),
  },
};
const serialized = `${JSON.stringify(output)}\n`;

if (checkOnly) {
  const existing = await readFile(OUTPUT, 'utf8');
  if (existing !== serialized) {
    throw new Error('字频数据与生成结果不一致，请运行 pnpm frequency:build');
  }
  console.log(
    `字频数据校验通过：简体 ${hansEntries.length} 字，繁体（推导）${hantEntries.length} 字。`,
  );
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, serialized, 'utf8');
  console.log(
    `已生成字频数据：${path.relative(ROOT, OUTPUT)}（简体 ${hansEntries.length} 字，繁体 ${hantEntries.length} 字）`,
  );
}
