/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MAX_NORMALIZED_FONT_SIZE,
  MAX_SFNT_TABLE_COUNT,
  MAX_WOFF2_INTERMEDIATE_COMPRESSION_RATIO,
} from './font-budget';
import { decompressWoff2, inspectWoff2DecompressionBudget } from './woff2';

const WOFF2_SIGNATURE = 0x774f4632;
const TTF_FLAVOR = 0x00010000;
const TTC_FLAVOR = 0x74746366;

function encodeUIntBase128(value: number): readonly number[] {
  const output = [value % 128];
  let remaining = Math.floor(value / 128);
  while (remaining > 0) {
    output.unshift((remaining % 128) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  return output;
}

function syntheticWoff2(options: {
  readonly directory: readonly number[];
  readonly flavor?: number;
  readonly reserved?: number;
  readonly tableCount?: number;
  readonly totalSfntSize?: number;
}): Uint8Array {
  const compressedData = Uint8Array.of(0);
  const length = 48 + options.directory.length + compressedData.byteLength;
  const output = new Uint8Array(length);
  const view = new DataView(output.buffer);
  view.setUint32(0, WOFF2_SIGNATURE, false);
  view.setUint32(4, options.flavor ?? TTF_FLAVOR, false);
  view.setUint32(8, length, false);
  view.setUint16(12, options.tableCount ?? 1, false);
  view.setUint16(14, options.reserved ?? 0, false);
  view.setUint32(16, options.totalSfntSize ?? 32, false);
  view.setUint32(20, compressedData.byteLength, false);
  output.set(options.directory, 48);
  output.set(compressedData, 48 + options.directory.length);
  return output;
}

function transformedGlyfDirectory(originalLength: number, transformLength: number): number[] {
  return [10, ...encodeUIntBase128(originalLength), ...encodeUIntBase128(transformLength)];
}

function untransformedCmapDirectory(originalLength: number): number[] {
  return [0, ...encodeUIntBase128(originalLength)];
}

function uint32Bytes(value: number): readonly number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

async function fixture(relativeUrl: string): Promise<Uint8Array> {
  const bytes = await readFile(fileURLToPath(new URL(relativeUrl, import.meta.url)));
  return Uint8Array.from(bytes);
}

describe('WOFF2 解压预算', () => {
  it('按 transformed glyf 的 transformLength 拒绝超过中间态预算的输入', () => {
    const data = syntheticWoff2({
      directory: transformedGlyfDirectory(1, MAX_NORMALIZED_FONT_SIZE + 1),
      totalSfntSize: 1,
    });
    expect(() => inspectWoff2DecompressionBudget(data)).toThrow(/WOFF2.*中间态.*100 MB/u);
  });

  it('在进入 decoder 前拒绝超过当前上游约束的中间态倍率', async () => {
    const data = syntheticWoff2({
      directory: untransformedCmapDirectory(MAX_WOFF2_INTERMEDIATE_COMPRESSION_RATIO * 1024),
    });
    await expect(decompressWoff2(data)).rejects.toThrow(/WOFF2.*倍率/u);
  });

  it('拒绝含前导零的 UIntBase128', () => {
    const data = syntheticWoff2({ directory: [0, 0x80, 0x01] });
    expect(() => inspectWoff2DecompressionBudget(data)).toThrow(/UIntBase128/u);
  });

  it('不把 advisory totalSfntSize 当作分配预算', () => {
    const data = syntheticWoff2({
      directory: untransformedCmapDirectory(32),
      totalSfntSize: 0xffffffff,
    });
    expect(inspectWoff2DecompressionBudget(data)).toEqual({ intermediateSize: 32 });
  });

  it('兼容规范要求 decoder 不得据此拒绝的非零 reserved 字段', () => {
    const data = syntheticWoff2({
      directory: untransformedCmapDirectory(32),
      reserved: 1,
    });
    expect(inspectWoff2DecompressionBudget(data)).toEqual({ intermediateSize: 32 });
  });

  it.each([
    ['glyf version 1', (1 << 6) | 10],
    ['loca version 2', (2 << 6) | 11],
    ['known hmtx version 2', (2 << 6) | 3],
    ['普通表 version 1', (1 << 6) | 0],
  ])('拒绝保留的 transform version：%s', (_label, flags) => {
    const data = syntheticWoff2({
      directory: [flags, ...encodeUIntBase128(32)],
    });
    expect(() => inspectWoff2DecompressionBudget(data)).toThrow(/transform version/u);
  });

  it('识别 explicit hmtx version 1 并按 transformLength 核算', () => {
    const data = syntheticWoff2({
      directory: [
        (1 << 6) | 63,
        ...uint32Bytes(0x686d7478),
        ...encodeUIntBase128(64),
        ...encodeUIntBase128(32),
      ],
    });
    expect(inspectWoff2DecompressionBudget(data)).toEqual({ intermediateSize: 32 });
  });

  it('接受 glyf/loca 的 null transform version 3', () => {
    const data = syntheticWoff2({
      directory: [(3 << 6) | 10, ...encodeUIntBase128(32)],
    });
    expect(inspectWoff2DecompressionBudget(data)).toEqual({ intermediateSize: 32 });
  });

  it('拒绝会让 SFNT searchRange 回绕的 4096 张表', () => {
    const data = syntheticWoff2({
      directory: [],
      tableCount: MAX_SFNT_TABLE_COUNT + 1,
    });
    expect(() => inspectWoff2DecompressionBudget(data)).toThrow(/WOFF2.*表数量/u);
  });

  it('在进入 decoder 前拒绝 WOFF2 字体合集', async () => {
    const data = syntheticWoff2({
      directory: untransformedCmapDirectory(32),
      flavor: TTC_FLAVOR,
    });
    await expect(decompressWoff2(data)).rejects.toThrow(/TTC|OTC/u);
  });

  it('接受并往返现有真实 WOFF2 fixture', async () => {
    const data = await fixture('../test/fixtures/abeezee/ABeeZee-Regular.woff2');
    const budget = inspectWoff2DecompressionBudget(data);
    expect(budget.intermediateSize).toBeGreaterThan(0);
    expect(budget.intermediateSize).toBeLessThanOrEqual(MAX_NORMALIZED_FONT_SIZE);
    const restored = await decompressWoff2(data);
    expect([...restored.subarray(0, 4)]).toEqual([0x00, 0x01, 0x00, 0x00]);
  });

  it('仅在 decoder 副本清零 advisory totalSfntSize 并保持真实输出长度', async () => {
    const data = await fixture('../test/fixtures/abeezee/ABeeZee-Regular.woff2');
    const poisoned = Uint8Array.from(data);
    const poisonedView = new DataView(poisoned.buffer);
    poisonedView.setUint32(16, 0xffffffff, false);

    const [expected, restored] = await Promise.all([
      decompressWoff2(data),
      decompressWoff2(poisoned),
    ]);
    expect(poisonedView.getUint32(16, false)).toBe(0xffffffff);
    expect(restored).toEqual(expected);
  });
});
