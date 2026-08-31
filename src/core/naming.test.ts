import { describe, expect, it } from 'vitest';
import {
  familySlug,
  fileNameFor,
  filePrefixFor,
  isValidFilePrefix,
  slug,
  variantToken,
} from './naming';

const values = {
  prefix: 'noto-sans-sc',
  weight: 400,
  style: 'normal' as const,
  index: '07',
};

describe('文件命名', () => {
  it('生成小写安全的 slug，中文字族退回 PostScript 名', () => {
    expect(slug('Noto Sans SC')).toBe('noto-sans-sc');
    expect(slug('SourceHanSans')).toBe('source-han-sans');
    expect(slug('Café Ünïcode')).toBe('cafe-unicode');
    expect(familySlug('思源黑体', 'SourceHanSansSC-Regular')).toBe('source-han-sans-sc');
    expect(familySlug('思源黑体', '')).toBe('webfont');
  });

  it('款式标记区分字重、斜体与宽度', () => {
    expect(variantToken({ weight: 400, style: 'normal' })).toBe('400');
    expect(variantToken({ weight: 700, style: 'italic' })).toBe('700i');
    expect(variantToken({ weight: [100, 900], style: 'normal', stretch: 75 })).toBe('100_900-w75');
  });

  it('文件名由前缀、款式与序号组成，可附加内容哈希', () => {
    expect(fileNameFor(values)).toBe('noto-sans-sc-400-07.woff2');
    expect(fileNameFor(values, 'abcd1234')).toBe('noto-sans-sc-400-07.abcd1234.woff2');
    expect(fileNameFor({ ...values, prefix: '', weight: [100, 900] })).toBe('100_900-07.woff2');
    expect(fileNameFor({ ...values, prefix: 'a/b c', index: '01' })).toBe('a-b-c-400-01.woff2');
  });

  it('自定义前缀优先于字族名，并只接受安全字符', () => {
    expect(filePrefixFor('', 'LXGW WenKai Lite', 'LXGWWenKaiLite-Regular')).toBe(
      'lxgw-wen-kai-lite',
    );
    expect(filePrefixFor(' lxgw ', 'LXGW WenKai Lite', '')).toBe('lxgw');
    expect(fileNameFor({ ...values, prefix: 'lxgw', index: '87' }, 'f73f604a')).toBe(
      'lxgw-400-87.f73f604a.woff2',
    );
    expect(isValidFilePrefix('lxgw')).toBe(true);
    expect(isValidFilePrefix('My_Font.v2')).toBe(true);
    expect(isValidFilePrefix('a')).toBe(true);
    expect(isValidFilePrefix('-lxgw')).toBe(false);
    expect(isValidFilePrefix('lxgw-')).toBe(false);
    expect(isValidFilePrefix('霞鹜')).toBe(false);
    expect(isValidFilePrefix('a/b')).toBe(false);
    expect(isValidFilePrefix('a'.repeat(65))).toBe(false);
  });
});
