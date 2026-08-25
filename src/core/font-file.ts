export const MAX_FONT_FILE_SIZE = 100 * 1024 * 1024;

export interface FontFileDescriptor {
  readonly name: string;
  readonly size: number;
}

export type FontFileMetadataRejectionCode = 'empty-file' | 'font-too-large';

export type FontFileMetadataValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly code: FontFileMetadataRejectionCode };

export function validateFontFileMetadata(file: FontFileDescriptor): FontFileMetadataValidation {
  if (file.size <= 0) return { valid: false, code: 'empty-file' };
  if (file.size > MAX_FONT_FILE_SIZE) return { valid: false, code: 'font-too-large' };
  return { valid: true };
}

/** 1024 进制的人类可读体积，最多三位有效数字。 */
export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) throw new RangeError('文件大小必须是非负有限数值');
  if (size < 1024) return `${String(Math.round(size))} B`;
  const units = ['KB', 'MB', 'GB'] as const;
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex] ?? 'GB'}`;
}
