/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { inspectFont } from './font-inspector';
import { collectSfntTableTags } from './sfnt';
import { HarfBuzzSubsetter } from './harfbuzz-subset';
import { bytesToArrayBuffer, compressWoff2, decompressWoff2 } from './woff2';

async function readArrayBuffer(relativeUrl: string): Promise<ArrayBuffer> {
  const bytes = await readFile(fileURLToPath(new URL(relativeUrl, import.meta.url)));
  return Uint8Array.from(bytes).buffer;
}

describe('HarfBuzz subset + WOFF2 集成', () => {
  it('将 TTF 裁剪为目标码点并完成 WOFF2 往返', async () => {
    const [wasm, sourceFont] = await Promise.all([
      readArrayBuffer('../../node_modules/hb-subset-wasm/dist/hb-subset.wasm'),
      readArrayBuffer('../test/fixtures/abeezee/ABeeZee-Regular.ttf'),
    ]);
    const subsetter = await HarfBuzzSubsetter.create(wasm);

    try {
      subsetter.loadFont(sourceFont);
      const subset = await subsetter.subset([0x41, 0x42, 0x43]);

      expect(subset.byteLength).toBeLessThan(sourceFont.byteLength);
      const parsedSubset = parse(bytesToArrayBuffer(subset));
      expect(parsedSubset.hasChar('A')).toBe(true);
      expect(parsedSubset.hasChar('B')).toBe(true);
      expect(parsedSubset.hasChar('C')).toBe(true);
      expect(parsedSubset.hasChar('D')).toBe(false);

      const woff2 = await compressWoff2(subset);
      expect(woff2.byteLength).toBeGreaterThan(0);
      expect(woff2.byteLength).toBeLessThan(subset.byteLength);

      const restored = await decompressWoff2(woff2);
      const parsedRestored = parse(bytesToArrayBuffer(restored));
      expect(parsedRestored.hasChar('A')).toBe(true);
      expect(parsedRestored.hasChar('D')).toBe(false);
    } finally {
      subsetter.dispose();
    }
  });

  it('裁剪 OTF/CFF 并编码为可回读的 WOFF2', async () => {
    const [wasm, sourceFont] = await Promise.all([
      readArrayBuffer('../../node_modules/hb-subset-wasm/dist/hb-subset.wasm'),
      readArrayBuffer('../test/fixtures/source-serif-4/SourceSerif4-Regular.otf'),
    ]);
    const subsetter = await HarfBuzzSubsetter.create(wasm);

    try {
      subsetter.loadFont(sourceFont);
      const subset = await subsetter.subset([0x41, 0x42, 0x43]);
      expect(new TextDecoder('latin1').decode(subset.slice(0, 4))).toBe('OTTO');
      const subsetBuffer = bytesToArrayBuffer(subset);
      const parsedSubset = parse(subsetBuffer);
      expect(parsedSubset.hasChar('A')).toBe(true);
      expect(parsedSubset.hasChar('D')).toBe(false);
      const inspectedSubset = inspectFont({
        fileName: 'SourceSerif4-Subset.otf',
        format: 'otf',
        sourceSize: subset.byteLength,
        normalizedData: subsetBuffer,
      }).inspection;
      expect(inspectedSubset.license).toContain('SIL Open Font License');

      const woff2 = await compressWoff2(subset);
      const restored = await decompressWoff2(woff2);
      const parsedRestored = parse(bytesToArrayBuffer(restored));
      expect(parsedRestored.hasChar('C')).toBe(true);
      expect(parsedRestored.hasChar('D')).toBe(false);
    } finally {
      subsetter.dispose();
    }
  });

  it('对子集后的 COLR 与可变字体保留必要表', async () => {
    const [wasm, colorFont, variableFont] = await Promise.all([
      readArrayBuffer('../../node_modules/hb-subset-wasm/dist/hb-subset.wasm'),
      readArrayBuffer('../test/fixtures/color-font/samples-glyf_colr_1.ttf'),
      readArrayBuffer('../test/fixtures/source-serif-4/SourceSerif4Variable-TestSubset.ttf'),
    ]);
    const subsetter = await HarfBuzzSubsetter.create(wasm);

    try {
      subsetter.loadFont(colorFont);
      const colorSubset = await subsetter.subset([0x61, 0x63]);
      expect(collectSfntTableTags(bytesToArrayBuffer(colorSubset))).toContain('colr');

      subsetter.loadFont(variableFont);
      const variableSubset = await subsetter.subset([0x41, 0x42]);
      const variableTags = collectSfntTableTags(bytesToArrayBuffer(variableSubset));
      expect(variableTags).toContain('fvar');
      expect(variableTags).toContain('gvar');
      expect(variableTags).toContain('avar');
      expect(variableTags).toContain('hvar');

      const staticInstance = await subsetter.subset([0x41, 0x42], {
        variationAxes: { wght: 400, opsz: 20 },
      });
      const staticTags = collectSfntTableTags(bytesToArrayBuffer(staticInstance));
      expect(staticTags).not.toContain('fvar');
      expect(staticTags).not.toContain('gvar');
      expect(staticTags).not.toContain('avar');
      expect(staticTags).not.toContain('hvar');
      expect(staticInstance.byteLength).toBeLessThan(variableSubset.byteLength);
    } finally {
      subsetter.dispose();
    }
  });
});
