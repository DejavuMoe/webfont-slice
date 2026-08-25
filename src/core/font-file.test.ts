import { describe, expect, it } from 'vitest';
import { MAX_FONT_FILE_SIZE, formatBytes, validateFontFileMetadata } from './font-file';

describe('font-file', () => {
  it('元数据预检不把扩展名或文件名作为格式资格条件', () => {
    expect(validateFontFileMetadata({ name: 'renamed.bin', size: 1024 })).toEqual({
      valid: true,
    });
    expect(validateFontFileMetadata({ name: 'extensionless', size: 1024 })).toEqual({
      valid: true,
    });
  });

  it('以稳定 code 拒绝空文件与超大文件', () => {
    expect(validateFontFileMetadata({ name: 'empty.ttf', size: 0 })).toEqual({
      valid: false,
      code: 'empty-file',
    });
    expect(validateFontFileMetadata({ name: 'large.bin', size: MAX_FONT_FILE_SIZE + 1 })).toEqual({
      valid: false,
      code: 'font-too-large',
    });
  });

  it('格式化文件大小', () => {
    expect(formatBytes(800)).toBe('800 B');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(10 * 1024 * 1024)).toBe('10.0 MB');
  });
});
