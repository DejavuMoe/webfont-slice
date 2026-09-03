import { Unzlib } from 'fflate';
import {
  MAX_SFNT_TABLE_COUNT,
  MAX_WOFF1_TABLE_COMPRESSION_RATIO,
  assertNormalizedFontSize,
  assertWoff1TableCompressionBudget,
} from './font-budget';

const WOFF_HEADER_SIZE = 44;
const WOFF_TABLE_ENTRY_SIZE = 20;
const SFNT_HEADER_SIZE = 12;
const SFNT_TABLE_ENTRY_SIZE = 16;
const CHECKSUM_MAGIC = 0xb1b0afba;
const MIN_COMPRESSED_INPUT_CHUNK_SIZE = 64;
const MAX_COMPRESSED_INPUT_CHUNK_SIZE = 8 * 1024;
const TARGET_OUTPUT_CHUNK_COUNT = 4;

interface WoffTableRecord {
  readonly tag: number;
  readonly checksum: number;
  readonly offset: number;
  readonly compressedLength: number;
  readonly originalLength: number;
}

interface WoffTable extends WoffTableRecord {
  readonly bytes: Uint8Array;
}

class Woff1TableLengthError extends Error {}

function align4(value: number): number {
  const remainder = value % 4;
  return remainder === 0 ? value : value + (4 - remainder);
}

function tableTag(tag: number): string {
  return String.fromCharCode(
    (tag >>> 24) & 0xff,
    (tag >>> 16) & 0xff,
    (tag >>> 8) & 0xff,
    tag & 0xff,
  );
}

function calculateChecksum(bytes: Uint8Array): number {
  const paddedLength = align4(bytes.byteLength);
  let sum = 0;
  for (let offset = 0; offset < paddedLength; offset += 4) {
    const word =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

function compressedInputChunkSize(originalLength: number): number {
  // 合法高压缩表通常约四次 push 完成；小声明保持 64 B 粒度以尽快阻断超长流。
  const target = Math.ceil(
    originalLength / (MAX_WOFF1_TABLE_COMPRESSION_RATIO * TARGET_OUTPUT_CHUNK_COUNT),
  );
  return Math.max(
    MIN_COMPRESSED_INPUT_CHUNK_SIZE,
    Math.min(MAX_COMPRESSED_INPUT_CHUNK_SIZE, target),
  );
}

function decompressTable(encoded: Uint8Array, originalLength: number): Uint8Array {
  const output = new Uint8Array(originalLength);
  let outputOffset = 0;
  const stream = new Unzlib((chunk) => {
    const nextOffset = outputOffset + chunk.byteLength;
    if (nextOffset > originalLength) throw new Woff1TableLengthError();
    output.set(chunk, outputOffset);
    outputOffset = nextOffset;
  });
  const chunkSize = compressedInputChunkSize(originalLength);
  for (let offset = 0; offset < encoded.byteLength; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, encoded.byteLength);
    stream.push(encoded.subarray(offset, end), end === encoded.byteLength);
  }
  if (outputOffset !== originalLength) throw new Woff1TableLengthError();
  return output;
}

/** 按 WOFF 1.0 规范逐表解包，原样保留 TTF/OTF 的全部 SFNT 表。 */
export function normalizeWoff1(data: ArrayBuffer): ArrayBuffer {
  if (data.byteLength < WOFF_HEADER_SIZE) throw new Error('WOFF1 文件头不完整');
  const source = new Uint8Array(data);
  const view = new DataView(data);
  if (view.getUint32(0, false) !== 0x774f4646) throw new Error('WOFF1 签名无效');

  const flavor = view.getUint32(4, false);
  const declaredLength = view.getUint32(8, false);
  const tableCount = view.getUint16(12, false);
  const reserved = view.getUint16(14, false);
  const declaredSfntSize = view.getUint32(16, false);
  if (declaredLength !== data.byteLength) throw new Error('WOFF1 声明长度与文件大小不一致');
  if (reserved !== 0) throw new Error('WOFF1 reserved 字段必须为 0');
  if (tableCount === 0 || tableCount > MAX_SFNT_TABLE_COUNT) {
    throw new Error('WOFF1 表数量无效');
  }
  if (WOFF_HEADER_SIZE + tableCount * WOFF_TABLE_ENTRY_SIZE > data.byteLength) {
    throw new Error('WOFF1 表目录越界');
  }

  const tableRecords: WoffTableRecord[] = [];
  const seenTags = new Set<number>();
  const spans: (readonly [number, number])[] = [];
  for (let index = 0; index < tableCount; index += 1) {
    const entryOffset = WOFF_HEADER_SIZE + index * WOFF_TABLE_ENTRY_SIZE;
    const tag = view.getUint32(entryOffset, false);
    const offset = view.getUint32(entryOffset + 4, false);
    const compressedLength = view.getUint32(entryOffset + 8, false);
    const originalLength = view.getUint32(entryOffset + 12, false);
    const checksum = view.getUint32(entryOffset + 16, false);
    if (seenTags.has(tag)) throw new Error(`WOFF1 包含重复表：${tableTag(tag)}`);
    seenTags.add(tag);
    if (offset % 4 !== 0 || compressedLength > originalLength) {
      throw new Error(`WOFF1 表 ${tableTag(tag)} 的长度或对齐无效`);
    }
    if (
      offset < WOFF_HEADER_SIZE + tableCount * WOFF_TABLE_ENTRY_SIZE ||
      offset + compressedLength > data.byteLength
    ) {
      throw new Error(`WOFF1 表 ${tableTag(tag)} 数据越界`);
    }
    spans.push([offset, offset + compressedLength]);
    tableRecords.push({ tag, checksum, offset, compressedLength, originalLength });
  }

  spans.sort((left, right) => left[0] - right[0]);
  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1];
    const current = spans[index];
    if (previous !== undefined && current !== undefined && current[0] < previous[1]) {
      throw new Error('WOFF1 表数据区间重叠');
    }
  }

  const expectedSfntSize =
    SFNT_HEADER_SIZE +
    tableCount * SFNT_TABLE_ENTRY_SIZE +
    tableRecords.reduce((total, table) => total + align4(table.originalLength), 0);
  assertNormalizedFontSize(expectedSfntSize, 'WOFF1 字体');
  if (declaredSfntSize !== expectedSfntSize) {
    throw new Error('WOFF1 声明的原始 SFNT 大小无效');
  }
  for (const table of tableRecords) {
    if (table.compressedLength < table.originalLength) {
      assertWoff1TableCompressionBudget(table.compressedLength, table.originalLength);
    }
  }

  const tables: WoffTable[] = tableRecords.map((table) => {
    const encoded = source.subarray(table.offset, table.offset + table.compressedLength);
    let bytes: Uint8Array;
    try {
      if (table.compressedLength < table.originalLength) {
        bytes = decompressTable(encoded, table.originalLength);
      } else {
        bytes = Uint8Array.from(encoded);
      }
    } catch (error: unknown) {
      if (error instanceof Woff1TableLengthError) {
        throw new Error(`WOFF1 表 ${tableTag(table.tag)} 解压长度不一致`, {
          cause: error,
        });
      }
      throw new Error(`WOFF1 表 ${tableTag(table.tag)} 解压失败`, { cause: error });
    }
    if (bytes.byteLength !== table.originalLength) {
      throw new Error(`WOFF1 表 ${tableTag(table.tag)} 解压长度不一致`);
    }
    return { ...table, bytes };
  });

  tables.sort((left, right) => left.tag - right.tag);
  const output = new Uint8Array(expectedSfntSize);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, flavor, false);
  outputView.setUint16(4, tableCount, false);
  const entrySelector = Math.floor(Math.log2(tableCount));
  const searchRange = 2 ** entrySelector * 16;
  outputView.setUint16(6, searchRange, false);
  outputView.setUint16(8, entrySelector, false);
  outputView.setUint16(10, tableCount * 16 - searchRange, false);

  let tableOffset = SFNT_HEADER_SIZE + tableCount * SFNT_TABLE_ENTRY_SIZE;
  let headOffset: number | null = null;
  for (const [index, table] of tables.entries()) {
    const directoryOffset = SFNT_HEADER_SIZE + index * SFNT_TABLE_ENTRY_SIZE;
    outputView.setUint32(directoryOffset, table.tag, false);
    outputView.setUint32(directoryOffset + 4, table.checksum, false);
    outputView.setUint32(directoryOffset + 8, tableOffset, false);
    outputView.setUint32(directoryOffset + 12, table.originalLength, false);
    output.set(table.bytes, tableOffset);
    if (tableTag(table.tag) === 'head') headOffset = tableOffset;
    tableOffset += align4(table.originalLength);
  }

  if (headOffset !== null && headOffset + 12 <= output.byteLength) {
    outputView.setUint32(headOffset + 8, 0, false);
    const adjustment = (CHECKSUM_MAGIC - calculateChecksum(output)) >>> 0;
    outputView.setUint32(headOffset + 8, adjustment, false);
  }
  return output.buffer;
}
