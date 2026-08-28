import { describe, expect, it } from 'vitest';
import { isExternalHttpUrl, parseCharsetIndex, parseCharsetPreset } from './charset-store';

const PRESET = {
  id: 'f-test',
  name: 'Test',
  category: 'functional',
  expectedCount: 4,
  standard: 'Test',
  description: 'Test',
  source: 'https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt',
  sourceRevision: '17.0.0',
  license: 'Unicode Terms of Use',
  ranges: [
    [0x41, 0x42],
    [0x4e00, 0x4e01],
  ],
};

describe('字表数据解析', () => {
  it('严格解析字表索引', () => {
    expect(
      parseCharsetIndex({
        version: 1,
        presets: [
          {
            id: 'u-test',
            name: 'Test',
            category: 'unicode',
            expectedCount: 1,
            standard: 'Test',
            description: 'Test',
          },
        ],
      }),
    ).toMatchObject({ version: 1, presets: [{ id: 'u-test' }] });
    expect(() => parseCharsetIndex({ version: 1, presets: [{ id: 'bad' }] })).toThrow();
    expect(() => parseCharsetIndex({ presets: [] })).toThrow();
  });

  it('展开区间为升序码点并保留来源信息', () => {
    const preset = parseCharsetPreset(PRESET);
    expect(preset.codePoints).toEqual([0x41, 0x42, 0x4e00, 0x4e01]);
    expect(preset.sourceRevision).toBe('17.0.0');
    expect(preset.ranges).toEqual(PRESET.ranges);
  });

  it('拒绝计数不符、乱序、重叠或非标量值的区间', () => {
    expect(() => parseCharsetPreset({ ...PRESET, expectedCount: 5 })).toThrow('展开数');
    expect(() =>
      parseCharsetPreset({
        ...PRESET,
        ranges: [
          [0x4e00, 0x4e01],
          [0x41, 0x42],
        ],
      }),
    ).toThrow();
    expect(() =>
      parseCharsetPreset({
        ...PRESET,
        ranges: [
          [0x41, 0x43],
          [0x42, 0x4e00],
        ],
      }),
    ).toThrow();
    expect(() =>
      parseCharsetPreset({ ...PRESET, expectedCount: 1, ranges: [[0xd800, 0xd800]] }),
    ).toThrow();
    expect(() => parseCharsetPreset({ ...PRESET, ranges: [[0x41]] })).toThrow('无效区间');
  });

  it('只接受可在静态站打开的 HTTP(S) 来源', () => {
    expect(isExternalHttpUrl(PRESET.source)).toBe(true);
    expect(isExternalHttpUrl('PLAN.md §4.5')).toBe(false);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isExternalHttpUrl('https://example.com/a b')).toBe(false);
    expect(() => parseCharsetPreset({ ...PRESET, source: 'PLAN.md §4.5' })).toThrow(
      '来源必须是绝对 HTTP(S) URL',
    );
    expect(() => parseCharsetPreset({ ...PRESET, license: undefined })).toThrow('缺少来源或许可');
  });
});
