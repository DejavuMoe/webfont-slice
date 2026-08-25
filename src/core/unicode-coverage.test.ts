import { describe, expect, it } from 'vitest';
import {
  calculateUnicodeBlockCoverage,
  classifyUnicodeBlock,
  summarizeUnicodeGroups,
  UNICODE_BLOCKS,
  UNICODE_BLOCKS_VERSION,
  type UnicodeBlockDefinition,
} from './unicode-coverage';

const sampleBlocks: readonly UnicodeBlockDefinition[] = [
  { id: 'basic-latin', name: 'Basic Latin', start: 0x0000, endInclusive: 0x007f },
  {
    id: 'cjk-unified-ideographs',
    name: 'CJK Unified Ideographs',
    start: 0x4e00,
    endInclusive: 0x9fff,
  },
  { id: 'hiragana', name: 'Hiragana', start: 0x3040, endInclusive: 0x309f },
].sort((left, right) => left.start - right.start);

describe('Unicode 区块覆盖统计', () => {
  it('按区块去重统计覆盖数量与百分比', () => {
    const coverage = calculateUnicodeBlockCoverage(
      [0x41, 0x41, 0x7a, 0x4e2d, 0x3042, 0x20000],
      sampleBlocks,
    );

    expect(coverage.find((block) => block.id === 'basic-latin')).toMatchObject({
      covered: 2,
      size: 128,
      coverageRate: 1.5625,
      group: 'latin',
      rangeLabel: 'U+0000-007F',
    });
    expect(coverage.find((block) => block.id === 'cjk-unified-ideographs')?.covered).toBe(1);
    expect(coverage.find((block) => block.id === 'hiragana')?.covered).toBe(1);
  });

  it('汇总拉丁、CJK、假名和谚文分组', () => {
    const coverage = calculateUnicodeBlockCoverage([0x41, 0x4e2d, 0x3042], sampleBlocks);
    const groups = summarizeUnicodeGroups(coverage);

    expect(groups.find((group) => group.group === 'latin')).toMatchObject({
      covered: 1,
      coveredBlockCount: 1,
    });
    expect(groups.find((group) => group.group === 'cjk')?.covered).toBe(1);
    expect(groups.find((group) => group.group === 'kana')?.covered).toBe(1);
    expect(classifyUnicodeBlock('Hangul Syllables')).toBe('hangul');
  });

  it('载入完整 Unicode 17 区块数据，包括代理项区块', () => {
    expect(UNICODE_BLOCKS_VERSION).toBe('17.0.0');
    expect(UNICODE_BLOCKS).toHaveLength(346);
    expect(() => calculateUnicodeBlockCoverage([0x41], UNICODE_BLOCKS)).not.toThrow();
    expect(UNICODE_BLOCKS.at(-1)?.endInclusive).toBe(0x10ffff);
  });

  it('拒绝无效码点', () => {
    expect(() => calculateUnicodeBlockCoverage([0xd800], sampleBlocks)).toThrow(RangeError);
    expect(() => calculateUnicodeBlockCoverage([0x110000], sampleBlocks)).toThrow(RangeError);
  });
});
