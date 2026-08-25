import unicodeBlocksData from '../data/unicode-blocks.json';
import { isUnicodeScalarValue, MAX_UNICODE_CODE_POINT } from './range-codec';

export type UnicodeBlockGroup = 'latin' | 'cjk' | 'kana' | 'hangul' | 'other';

export interface UnicodeBlockDefinition {
  readonly id: string;
  readonly name: string;
  readonly start: number;
  readonly endInclusive: number;
}

export interface UnicodeBlockCoverage extends UnicodeBlockDefinition {
  readonly displayName: string;
  readonly group: UnicodeBlockGroup;
  readonly size: number;
  readonly covered: number;
  readonly coverageRate: number;
  readonly rangeLabel: string;
}

export interface UnicodeGroupCoverage {
  readonly group: UnicodeBlockGroup;
  readonly label: string;
  readonly blockCount: number;
  readonly coveredBlockCount: number;
  readonly size: number;
  readonly covered: number;
  readonly coverageRate: number;
}

export const UNICODE_BLOCKS_VERSION = unicodeBlocksData.version;
export const UNICODE_BLOCKS_SOURCE = unicodeBlocksData.source;
export const UNICODE_BLOCKS: readonly UnicodeBlockDefinition[] = unicodeBlocksData.blocks;

export const FEATURED_UNICODE_BLOCK_IDS: readonly string[] = [
  'basic-latin',
  'latin-1-supplement',
  'latin-extended-a',
  'latin-extended-b',
  'cjk-symbols-and-punctuation',
  'cjk-unified-ideographs',
  'cjk-unified-ideographs-extension-a',
  'cjk-unified-ideographs-extension-b',
  'cjk-compatibility-ideographs',
  'hiragana',
  'katakana',
  'katakana-phonetic-extensions',
  'kana-supplement',
  'hangul-jamo',
  'hangul-compatibility-jamo',
  'hangul-syllables',
] as const;

const BLOCK_LABELS_ZH: Readonly<Record<string, string>> = {
  'basic-latin': '基本拉丁',
  'latin-1-supplement': '拉丁-1 补充',
  'latin-extended-a': '拉丁扩展 A',
  'latin-extended-b': '拉丁扩展 B',
  'cjk-symbols-and-punctuation': 'CJK 符号和标点',
  'cjk-unified-ideographs': 'CJK 统一表意文字',
  'cjk-unified-ideographs-extension-a': 'CJK 扩展 A',
  'cjk-unified-ideographs-extension-b': 'CJK 扩展 B',
  'cjk-compatibility-ideographs': 'CJK 兼容表意文字',
  hiragana: '平假名',
  katakana: '片假名',
  'katakana-phonetic-extensions': '片假名语音扩展',
  'kana-supplement': '假名补充',
  'hangul-jamo': '谚文字母',
  'hangul-compatibility-jamo': '谚文兼容字母',
  'hangul-syllables': '谚文音节',
};

const GROUP_LABELS: Readonly<Record<UnicodeBlockGroup, string>> = {
  latin: '拉丁',
  cjk: 'CJK',
  kana: '假名',
  hangul: '谚文',
  other: '其他',
};

function formatBlockBoundary(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UNICODE_CODE_POINT) {
    throw new RangeError(`无效的 Unicode 区块边界：${String(value)}`);
  }
  return `U+${value.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function classifyUnicodeBlock(name: string): UnicodeBlockGroup {
  if (/Hiragana|Katakana|Kana/u.test(name)) return 'kana';
  if (name.includes('Hangul')) return 'hangul';
  if (/CJK|Ideograph|Ideographic|Bopomofo|Kanbun|Kangxi|Yijing/u.test(name)) return 'cjk';
  if (/Latin|IPA Extensions|Phonetic Extensions|Combining Diacritical Marks/u.test(name)) {
    return 'latin';
  }
  return 'other';
}

export function unicodeBlockDisplayName(block: UnicodeBlockDefinition): string {
  const chineseName = BLOCK_LABELS_ZH[block.id];
  return chineseName === undefined ? block.name : `${chineseName} / ${block.name}`;
}

export function calculateUnicodeBlockCoverage(
  codePoints: Iterable<number>,
  blocks: readonly UnicodeBlockDefinition[] = UNICODE_BLOCKS,
): UnicodeBlockCoverage[] {
  const sortedCodePoints = [...new Set(codePoints)].sort((left, right) => left - right);
  for (const codePoint of sortedCodePoints) {
    if (!isUnicodeScalarValue(codePoint)) {
      throw new RangeError(`无效的 Unicode 码点：${String(codePoint)}`);
    }
  }

  let codePointIndex = 0;
  return blocks.map((block) => {
    while (
      codePointIndex < sortedCodePoints.length &&
      (sortedCodePoints[codePointIndex] ?? Number.POSITIVE_INFINITY) < block.start
    ) {
      codePointIndex += 1;
    }

    let covered = 0;
    while (
      codePointIndex < sortedCodePoints.length &&
      (sortedCodePoints[codePointIndex] ?? Number.POSITIVE_INFINITY) <= block.endInclusive
    ) {
      covered += 1;
      codePointIndex += 1;
    }

    const size = block.endInclusive - block.start + 1;
    return {
      ...block,
      displayName: unicodeBlockDisplayName(block),
      group: classifyUnicodeBlock(block.name),
      size,
      covered,
      coverageRate: size === 0 ? 0 : (covered / size) * 100,
      rangeLabel: `${formatBlockBoundary(block.start)}-${formatBlockBoundary(block.endInclusive).slice(2)}`,
    };
  });
}

export function summarizeUnicodeGroups(
  blocks: readonly UnicodeBlockCoverage[],
): UnicodeGroupCoverage[] {
  const groups: UnicodeBlockGroup[] = ['latin', 'cjk', 'kana', 'hangul', 'other'];

  return groups.map((group) => {
    const matchingBlocks = blocks.filter((block) => block.group === group);
    const size = matchingBlocks.reduce((total, block) => total + block.size, 0);
    const covered = matchingBlocks.reduce((total, block) => total + block.covered, 0);
    return {
      group,
      label: GROUP_LABELS[group],
      blockCount: matchingBlocks.length,
      coveredBlockCount: matchingBlocks.filter((block) => block.covered > 0).length,
      size,
      covered,
      coverageRate: size === 0 ? 0 : (covered / size) * 100,
    };
  });
}
