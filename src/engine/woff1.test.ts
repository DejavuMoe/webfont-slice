/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Unzlib, zlibSync } from 'fflate';
import { parse } from 'opentype.js';
import { describe, expect, it, vi } from 'vitest';
import { collectSfntTableTags } from './sfnt';
import {
  MAX_NORMALIZED_FONT_SIZE,
  MAX_SFNT_TABLE_COUNT,
  MAX_WOFF1_TABLE_COMPRESSION_RATIO,
} from './font-budget';
import { normalizeWoff1 } from './woff1';

function align4(value: number): number {
  const remainder = value % 4;
  return remainder === 0 ? value : value + (4 - remainder);
}

/** 仅用于测试：把任意 SFNT 表按 WOFF1 规范压缩，不重写字体。 */
function encodeWoff1(sfnt: ArrayBuffer): ArrayBuffer {
  const input = new Uint8Array(sfnt);
  const view = new DataView(sfnt);
  const tableCount = view.getUint16(4, false);
  const tables = Array.from({ length: tableCount }, (_, index) => {
    const offset = 12 + index * 16;
    const tableOffset = view.getUint32(offset + 8, false);
    const length = view.getUint32(offset + 12, false);
    const original = input.subarray(tableOffset, tableOffset + length);
    const compressed = zlibSync(original);
    return {
      tag: view.getUint32(offset, false),
      checksum: view.getUint32(offset + 4, false),
      original: Uint8Array.from(original),
      encoded: compressed.byteLength < original.byteLength ? compressed : Uint8Array.from(original),
    };
  });
  const length =
    44 +
    tableCount * 20 +
    tables.reduce((total, table) => total + align4(table.encoded.byteLength), 0);
  const output = new Uint8Array(length);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, 0x774f4646, false);
  outputView.setUint32(4, view.getUint32(0, false), false);
  outputView.setUint32(8, length, false);
  outputView.setUint16(12, tableCount, false);
  outputView.setUint16(14, 0, false);
  outputView.setUint32(
    16,
    12 +
      tableCount * 16 +
      tables.reduce((total, table) => total + align4(table.original.byteLength), 0),
    false,
  );
  outputView.setUint16(20, 1, false);
  outputView.setUint16(22, 0, false);
  let dataOffset = 44 + tableCount * 20;
  for (const [index, table] of tables.entries()) {
    const offset = 44 + index * 20;
    outputView.setUint32(offset, table.tag, false);
    outputView.setUint32(offset + 4, dataOffset, false);
    outputView.setUint32(offset + 8, table.encoded.byteLength, false);
    outputView.setUint32(offset + 12, table.original.byteLength, false);
    outputView.setUint32(offset + 16, table.checksum, false);
    output.set(table.encoded, dataOffset);
    dataOffset += align4(table.encoded.byteLength);
  }
  return output.buffer;
}

async function fixture(relativeUrl: string): Promise<ArrayBuffer> {
  const bytes = await readFile(fileURLToPath(new URL(relativeUrl, import.meta.url)));
  return Uint8Array.from(bytes).buffer;
}

function encodeSingleTableWoff1(options: {
  readonly encoded: Uint8Array;
  readonly originalLength: number;
  readonly declaredSfntSize?: number;
}): ArrayBuffer {
  const tableOffset = 44 + 20;
  const length = align4(tableOffset + options.encoded.byteLength);
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x774f4646, false);
  view.setUint32(4, 0x00010000, false);
  view.setUint32(8, length, false);
  view.setUint16(12, 1, false);
  view.setUint16(14, 0, false);
  view.setUint32(16, options.declaredSfntSize ?? 12 + 16 + align4(options.originalLength), false);
  view.setUint16(20, 1, false);
  view.setUint16(22, 0, false);
  view.setUint32(44, 0x74657374, false);
  view.setUint32(48, tableOffset, false);
  view.setUint32(52, options.encoded.byteLength, false);
  view.setUint32(56, options.originalLength, false);
  view.setUint32(60, 0, false);
  output.set(options.encoded, tableOffset);
  return output.buffer;
}

function woff1WithTableCount(tableCount: number): ArrayBuffer {
  const output = new ArrayBuffer(44);
  const view = new DataView(output);
  view.setUint32(0, 0x774f4646, false);
  view.setUint32(8, output.byteLength, false);
  view.setUint16(12, tableCount, false);
  return output;
}

describe('WOFF1 表级解包', () => {
  it('将 glyf WOFF1 还原为可解析 SFNT', async () => {
    const data = await fixture('../test/fixtures/abeezee/ABeeZee-Regular.woff');
    const normalized = normalizeWoff1(data);
    expect([...new Uint8Array(normalized, 0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
    const font = parse(normalized);
    expect(font.hasChar('A')).toBe(true);
    expect(font.numGlyphs).toBeGreaterThan(200);
  });

  it('原样保留 WOFF-CFF 的 CFF、GSUB、GPOS 与全部表', async () => {
    const otf = await fixture('../test/fixtures/source-serif-4/SourceSerif4-Regular.otf');
    const restored = normalizeWoff1(encodeWoff1(otf));
    expect(new TextDecoder('latin1').decode(restored.slice(0, 4))).toBe('OTTO');
    expect([...collectSfntTableTags(restored)].sort()).toEqual(
      [...collectSfntTableTags(otf)].sort(),
    );
    const tags = collectSfntTableTags(restored);
    expect(tags).toContain('cff ');
    expect(tags).toContain('gsub');
    expect(tags).toContain('gpos');
    expect(parse(restored).hasChar('A')).toBe(true);
  });

  it('拒绝目录越界和重叠的损坏 WOFF', async () => {
    const data = await fixture('../test/fixtures/abeezee/ABeeZee-Regular.woff');
    const damaged = data.slice(0);
    new DataView(damaged).setUint32(48, damaged.byteLength + 4, false);
    expect(() => normalizeWoff1(damaged)).toThrow(/越界|长度/);
  });

  it('在接触压缩流前拒绝超过归一化预算的目录声明', () => {
    const data = encodeSingleTableWoff1({
      encoded: Uint8Array.of(0),
      originalLength: MAX_NORMALIZED_FONT_SIZE + 1,
    });
    expect(() => normalizeWoff1(data)).toThrow(/WOFF1.*100 MB/u);
  });

  it('拒绝超过 zlib 理论上限的单表声明倍率', () => {
    const data = encodeSingleTableWoff1({
      encoded: Uint8Array.of(0),
      originalLength: MAX_WOFF1_TABLE_COMPRESSION_RATIO + 1,
    });
    expect(() => normalizeWoff1(data)).toThrow(/WOFF1.*倍率/u);
  });

  it('不会让大于 32 位有符号范围的 originalLength 在四字节对齐时回绕', () => {
    const data = encodeSingleTableWoff1({
      encoded: Uint8Array.of(0),
      originalLength: 0xffffffff,
      declaredSfntSize: 0xffffffff,
    });
    expect(() => normalizeWoff1(data)).toThrow(/WOFF1.*100 MB/u);
  });

  it('拒绝会让 SFNT searchRange 回绕的 4096 张表', () => {
    expect(() => normalizeWoff1(woff1WithTableCount(MAX_SFNT_TABLE_COUNT + 1))).toThrow(
      /WOFF1.*表数量/u,
    );
  });

  it('在实际展开超过声明后停止继续读取压缩流', () => {
    const encoded = zlibSync(new Uint8Array(2 * 1024 * 1024));
    const data = encodeSingleTableWoff1({
      encoded,
      originalLength: encoded.byteLength + 1,
    });
    const pushSpy = vi.spyOn(Unzlib.prototype, 'push');
    try {
      expect(() => normalizeWoff1(data)).toThrow(/解压长度不一致/u);
      expect(pushSpy).toHaveBeenCalledTimes(1);
      expect(pushSpy.mock.calls[0]?.[0]).toHaveLength(64);
      expect(pushSpy.mock.calls[0]?.[1]).toBe(false);
      const consumed = pushSpy.mock.calls.reduce((total, [chunk]) => total + chunk.byteLength, 0);
      expect(consumed).toBeLessThan(encoded.byteLength);
    } finally {
      pushSpy.mockRestore();
    }
  });
});
