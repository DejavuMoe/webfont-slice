import { MAX_FONT_FILE_SIZE } from '../core/font-file';

/** 归一化后交给 opentype/HarfBuzz 的单字体硬上限。 */
export const MAX_NORMALIZED_FONT_SIZE = MAX_FONT_FILE_SIZE;

/** 与当前 google/woff2 decoder 一致的 Brotli 中间态倍率上限。 */
export const MAX_WOFF2_INTERMEDIATE_COMPRESSION_RATIO = 100;

/** zlib 格式的理论最大压缩倍率约为 1032:1。 */
export const MAX_WOFF1_TABLE_COMPRESSION_RATIO = 1032;

/** 超过该大小仍可在桌面端继续，但需要提示移动设备内存风险。 */
export const LARGE_NORMALIZED_FONT_SIZE = 64 * 1024 * 1024;

/** 4096 张表会让 SFNT offset table 的 UInt16 searchRange 回绕。 */
export const MAX_SFNT_TABLE_COUNT = 4095;

function assertByteLength(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label}不是安全的非负字节数`);
  }
}

export function assertNormalizedFontSize(byteLength: number, label = '字体'): void {
  assertByteLength(byteLength, `${label}归一化大小`);
  if (byteLength > MAX_NORMALIZED_FONT_SIZE) {
    throw new Error(`${label}归一化后超过 100 MB 安全上限`);
  }
}

export function assertWoff1TableCompressionBudget(
  compressedLength: number,
  originalLength: number,
): void {
  assertByteLength(compressedLength, 'WOFF1 表压缩长度');
  assertByteLength(originalLength, 'WOFF1 表原始长度');
  if (
    compressedLength === 0 ||
    originalLength > compressedLength * MAX_WOFF1_TABLE_COMPRESSION_RATIO
  ) {
    throw new Error(`WOFF1 表解压倍率超过 ${String(MAX_WOFF1_TABLE_COMPRESSION_RATIO)} 倍安全上限`);
  }
}

export function assertWoff2IntermediateBudget(sourceSize: number, intermediateSize: number): void {
  assertByteLength(sourceSize, 'WOFF2 源文件大小');
  assertByteLength(intermediateSize, 'WOFF2 解压中间态大小');
  if (intermediateSize > MAX_NORMALIZED_FONT_SIZE) {
    throw new Error('WOFF2 解压中间态超过 100 MB 安全上限');
  }
  if (
    sourceSize === 0 ||
    intermediateSize > sourceSize * MAX_WOFF2_INTERMEDIATE_COMPRESSION_RATIO
  ) {
    throw new Error(
      `WOFF2 解压倍率超过 ${String(MAX_WOFF2_INTERMEDIATE_COMPRESSION_RATIO)} 倍安全上限`,
    );
  }
}
