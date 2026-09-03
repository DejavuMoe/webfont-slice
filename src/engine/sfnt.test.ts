/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { HarfBuzzSubsetter } from './harfbuzz-subset';
import {
  collectSfntTableTags,
  readGlyphSizes,
  readLayoutFeatures,
  readTableDirectory,
  rebuildSfnt,
  trimNameTable,
} from './sfnt';

async function fixture(relativeUrl: string): Promise<ArrayBuffer> {
  const bytes = await readFile(fileURLToPath(new URL(relativeUrl, import.meta.url)));
  return Uint8Array.from(bytes).buffer;
}

function checksumOk(sfnt: Uint8Array): boolean {
  let sum = 0;
  for (let offset = 0; offset < sfnt.byteLength; offset += 4) {
    const value =
      ((sfnt[offset] ?? 0) << 24) |
      ((sfnt[offset + 1] ?? 0) << 16) |
      ((sfnt[offset + 2] ?? 0) << 8) |
      (sfnt[offset + 3] ?? 0);
    sum = (sum + (value >>> 0)) >>> 0;
  }
  return sum === 0xb1b0afba;
}

describe('SFNT 读取', () => {
  it('读取表目录与布局特性', async () => {
    const data = await fixture('../test/fixtures/source-serif-4/SourceSerif4-Regular.otf');
    expect(readTableDirectory(data).has('CFF ')).toBe(true);
    expect(collectSfntTableTags(data)).toContain('cff ');
    expect(readLayoutFeatures(data)).toEqual(expect.arrayContaining(['kern', 'liga', 'tnum']));
  });

  it('按 glyph id 读取 glyf、CFF 与 gvar 体积', async () => {
    const glyf = readGlyphSizes(await fixture('../test/fixtures/abeezee/ABeeZee-Regular.ttf'));
    expect(glyf.flavor).toBe('glyf');
    expect(glyf.variation).toBeNull();
    expect(glyf.outline.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(1000);

    const cff = readGlyphSizes(
      await fixture('../test/fixtures/source-serif-4/SourceSerif4-Regular.otf'),
    );
    expect(cff.flavor).toBe('cff');
    expect(cff.outline.length).toBeGreaterThan(1000);

    const variable = readGlyphSizes(
      await fixture('../test/fixtures/source-serif-4/SourceSerif4Variable-TestSubset.ttf'),
    );
    expect(variable.variation?.some((value) => value > 0)).toBe(true);
  });

  it('损坏数据退回空结果而不是抛错', () => {
    const garbage = new Uint8Array([0, 1, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0]).buffer;
    expect(readGlyphSizes(garbage).flavor).toBe('unknown');
    expect(readTableDirectory(new ArrayBuffer(4)).size).toBe(0);
    expect(readLayoutFeatures(garbage)).toEqual([]);
  });
});

describe('name 表精简', () => {
  it('保留字族、版权与许可，文件变小且校验和正确', async () => {
    const [wasm, font] = await Promise.all([
      fixture('../../node_modules/hb-subset-wasm/dist/hb-subset.wasm'),
      fixture('../test/fixtures/source-serif-4/SourceSerif4-Regular.otf'),
    ]);
    const subsetter = await HarfBuzzSubsetter.create(wasm);
    try {
      subsetter.loadFont(font);
      const full = await subsetter.subset([0x41, 0x42], { trimMetadata: false });
      const trimmed = trimNameTable(full);
      expect(trimmed.byteLength).toBeLessThan(full.byteLength);
      expect(checksumOk(trimmed)).toBe(true);
      const parsed = parse(Uint8Array.from(trimmed).buffer);
      expect(parsed.hasChar('A')).toBe(true);
      const names = parsed.names as unknown as Record<
        string,
        Record<string, Record<string, string>> | undefined
      >;
      const windows = names.windows ?? {};
      expect(Object.values(windows.fontFamily ?? {})[0]).toBe('Source Serif 4');
      expect(Object.values(windows.license ?? {})[0]).toContain('SIL Open Font License');
      expect(Object.values(windows.copyright ?? {}).length).toBeGreaterThan(0);
      expect(trimNameTable(trimmed)).toBe(trimmed);
    } finally {
      subsetter.dispose();
    }
  });

  it('无法解析时原样返回', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(trimNameTable(bytes)).toBe(bytes);
  });

  it('重建 SFNT 时表按标签排序并计算校验和', () => {
    const head = new Uint8Array(54);
    const rebuilt = rebuildSfnt(
      0x00010000,
      new Map([
        ['zzzz', new Uint8Array([1, 2, 3])],
        ['head', head],
      ]),
    );
    expect([...readTableDirectory(rebuilt).keys()]).toEqual(['head', 'zzzz']);
    expect(checksumOk(rebuilt)).toBe(true);
  });
});
