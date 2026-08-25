import { describe, expect, it } from 'vitest';
import { detectFontFormat, formatLabel, isProcessableFontFormat } from './font-format';

function ascii(value: string): Uint8Array {
  return Uint8Array.from(Array.from(value, (character) => character.charCodeAt(0)));
}

describe('font-format', () => {
  it.each([
    ['OTTO', 'otf'],
    ['wOFF', 'woff'],
    ['wOF2', 'woff2'],
    ['ttcf', 'ttc'],
    ['true', 'ttf'],
  ] as const)('根据 %s 文件头识别 %s', (signature, expected) => {
    expect(detectFontFormat(ascii(signature))).toBe(expected);
  });

  it('识别标准 TrueType 标量头并拒绝未知内容', () => {
    expect(detectFontFormat(Uint8Array.of(0, 1, 0, 0))).toBe('ttf');
    expect(detectFontFormat(Uint8Array.of(0, 1, 0))).toBe('unknown');
    expect(detectFontFormat(ascii('NOPE'))).toBe('unknown');
    expect(formatLabel('woff2')).toContain('WOFF2');
  });

  it('只把独立字体容器标记为可处理格式', () => {
    expect(isProcessableFontFormat('ttf')).toBe(true);
    expect(isProcessableFontFormat('otf')).toBe(true);
    expect(isProcessableFontFormat('woff')).toBe(true);
    expect(isProcessableFontFormat('woff2')).toBe(true);
    expect(isProcessableFontFormat('ttc')).toBe(false);
    expect(isProcessableFontFormat('unknown')).toBe(false);
  });
});
