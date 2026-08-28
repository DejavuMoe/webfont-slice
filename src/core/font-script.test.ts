import { describe, expect, it } from 'vitest';
import { requiredPresetIds, DEFAULT_CHARACTER_SETTINGS } from './character-settings';
import { classifyFontScript, WESTERN_LEVEL_RANGES } from './font-script';
import { countRanges, filterByRanges, validateRanges } from './range-codec';

const ascii = Array.from({ length: 95 }, (_, index) => 0x20 + index);

describe('字体文字类型', () => {
  it('成规模的汉字、假名或谚文按 CJK，其余按西文', () => {
    expect(classifyFontScript(ascii)).toBe('western');
    expect(classifyFontScript([...ascii, 0x4e00, 0x4e01])).toBe('western');
    expect(
      classifyFontScript([...ascii, ...Array.from({ length: 10 }, (_, i) => 0x4e00 + i)]),
    ).toBe('cjk');
    expect(classifyFontScript(Array.from({ length: 86 }, (_, i) => 0x3041 + i))).toBe('cjk');
    expect(classifyFontScript(Array.from({ length: 200 }, (_, i) => 0xac00 + i))).toBe('cjk');
    expect(classifyFontScript([])).toBe('western');
  });

  it('西文档位区间升序不重叠，多语言包含西欧', () => {
    validateRanges(WESTERN_LEVEL_RANGES.common);
    validateRanges(WESTERN_LEVEL_RANGES.full);
    const common = filterByRanges(ascii, WESTERN_LEVEL_RANGES.common);
    expect(common).toEqual(ascii);
    expect(countRanges(WESTERN_LEVEL_RANGES.full)).toBeGreaterThan(
      countRanges(WESTERN_LEVEL_RANGES.common),
    );
    const sample = [0x41, 0xe9, 0x101, 0x3b1, 0x430, 0x1ea1, 0x2500, 0xe0a0];
    expect(filterByRanges(sample, WESTERN_LEVEL_RANGES.common)).toEqual([0x41, 0xe9]);
    expect(filterByRanges(sample, WESTERN_LEVEL_RANGES.full)).toEqual([
      0x41, 0xe9, 0x101, 0x3b1, 0x430, 0x1ea1,
    ]);
  });

  it('西文字体不引用汉字字表与附加字符，字表库照常生效', () => {
    const settings = {
      ...DEFAULT_CHARACTER_SETTINGS,
      extras: ['kana' as const],
      libraryIds: ['f-symbols'],
    };
    expect(requiredPresetIds(settings, 'hans', [], 'western')).toEqual(['f-symbols']);
    expect(requiredPresetIds(settings, 'hans', [], 'cjk')).toEqual(
      expect.arrayContaining(['sc-tgh-1', 'u-kana', 'f-symbols']),
    );
  });
});
