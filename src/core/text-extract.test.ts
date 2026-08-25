import { describe, expect, it } from 'vitest';
import { extractCodePoints } from './text-extract';

describe('extractCodePoints', () => {
  it('按 Unicode 码点去重，不拆分代理对', () => {
    expect([...extractCodePoints('测试𠀀测试')]).toEqual([0x6d4b, 0x8bd5, 0x20000]);
  });

  it('默认忽略空白，并允许显式保留', () => {
    expect([...extractCodePoints('A \nB')]).toEqual([0x41, 0x42]);
    expect([...extractCodePoints('A \nB　', { includeWhitespace: true })]).toEqual([
      0x41, 0x20, 0x42, 0x3000,
    ]);
  });
});
