import { describe, expect, it } from 'vitest';
import {
  compressRanges,
  countRanges,
  expandRanges,
  formatUnicodeRanges,
  isUnicodeScalarValue,
  validateRanges,
} from './range-codec';

describe('range-codec', () => {
  it('压缩、去重并排序码点', () => {
    expect(compressRanges([0x4e02, 0x4e00, 0x4e01, 0x4e01, 0x3001])).toEqual([
      [0x3001, 0x3001],
      [0x4e00, 0x4e02],
    ]);
  });

  it('支持辅助平面码点并保证往返一致', () => {
    const input = [0x20, 0x21, 0x20000, 0x20001, 0x2a6df];
    expect(expandRanges(compressRanges(input))).toEqual(input);
  });

  it('生成规范的 CSS unicode-range', () => {
    expect(
      formatUnicodeRanges([
        [0x20, 0x7e],
        [0x3001, 0x3001],
        [0x20000, 0x20001],
      ]),
    ).toBe('U+0020-007E, U+3001, U+20000-20001');
  });

  it('统计区间内码点数', () => {
    expect(
      countRanges([
        [0x20, 0x22],
        [0x100, 0x101],
      ]),
    ).toBe(5);
  });

  it('拒绝重叠、逆序与代理项', () => {
    expect(() => {
      validateRanges([[2, 1]]);
    }).toThrow(RangeError);
    expect(() => {
      validateRanges([
        [1, 2],
        [2, 3],
      ]);
    }).toThrow(RangeError);
    expect(() => compressRanges([0xd800])).toThrow(RangeError);
    expect(isUnicodeScalarValue(0x10ffff)).toBe(true);
    expect(isUnicodeScalarValue(0x110000)).toBe(false);
  });
});
