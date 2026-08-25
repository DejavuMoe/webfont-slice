import { describe, expect, it } from 'vitest';
import { parseUnicodeInput } from './unicode-input';

describe('Unicode 区间输入', () => {
  it('解析单点、区间和辅助平面码点', () => {
    const result = parseUnicodeInput('U+0041, U+4E00-4E02; U+20000');
    expect([...result.codePoints]).toEqual([0x41, 0x4e00, 0x4e01, 0x4e02, 0x20000]);
    expect(result.errors).toEqual([]);
  });

  it('返回带偏移量的语法与范围错误', () => {
    const result = parseUnicodeInput('U+XYZ U+10FFFF-110000 U+D800');
    expect(result.codePoints.size).toBe(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0]).toMatchObject({ token: 'U+XYZ', offset: 0 });
    expect(result.errors[1]?.message).toContain('U+10FFFF');
    expect(result.errors[2]?.message).toContain('代理项');
  });

  it('重复区间不重复占用展开上限', () => {
    const result = parseUnicodeInput('U+0041-0043, U+0041-0042', 3);
    expect([...result.codePoints]).toEqual([0x41, 0x42, 0x43]);
    expect(result.errors).toEqual([]);
  });

  it('限制异常大的展开输入', () => {
    const result = parseUnicodeInput('U+0000-00FF', 100);
    expect(result.codePoints.size).toBe(0);
    expect(result.errors[0]?.message).toContain('100');
  });
});
