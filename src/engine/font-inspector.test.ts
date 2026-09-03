/// <reference types="node" />

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { classifyFontScript } from '../core/font-script';
import { inspectFont } from './font-inspector';

async function fixture(relativeUrl: string): Promise<ArrayBuffer> {
  const bytes = await readFile(fileURLToPath(new URL(relativeUrl, import.meta.url)));
  return Uint8Array.from(bytes).buffer;
}

function inspect(data: ArrayBuffer, fileName: string) {
  return inspectFont({ fileName, format: 'ttf', sourceSize: data.byteLength, normalizedData: data })
    .inspection;
}

describe('字体分析', () => {
  it('读取名称、字重、cmap、度量与逐字形体积', async () => {
    const data = await fixture('../test/fixtures/abeezee/ABeeZee-Regular.ttf');
    const inspection = inspect(data, 'ABeeZee-Regular.ttf');
    expect(inspection.family).toBe('ABeeZee');
    expect(inspection.weight).toBe(400);
    expect(inspection.style).toBe('normal');
    expect(inspection.glyphCount).toBeGreaterThan(200);
    expect(inspection.coverage).toContain(0x41);
    expect(inspection.coverage).toEqual([...inspection.coverage].sort((a, b) => a - b));
    expect(inspection.glyphCosts.outlineBytes).toHaveLength(inspection.coverage.length);
    expect(inspection.glyphCosts.outlineBytes.some((bytes) => bytes > 0)).toBe(true);
    expect(inspection.glyphCosts.calibrated).toBe(false);
    expect(
      inspection.blockCoverage.find((block) => block.id === 'basic-latin')?.covered,
    ).toBeGreaterThan(0);
    expect(inspection.monospace).toBe(false);
    expect(classifyFontScript(inspection.coverage)).toBe('western');
  });

  it('识别等宽代码字体，并列出连字与风格集特性', async () => {
    const mono = inspect(
      await fixture('../test/fixtures/jetbrains-mono-subset/JetBrainsMono-TestSubset.ttf'),
      'mono.ttf',
    );
    expect(mono.family).toBe('JetBrains Mono');
    expect(mono.monospace).toBe(true);
    expect(classifyFontScript(mono.coverage)).toBe('western');
    expect(mono.layoutFeatures).toEqual(expect.arrayContaining(['calt', 'ss01', 'cv01', 'zero']));
  });

  it('识别 CJK 字体与 CFF 字形体积', async () => {
    const cjk = inspect(
      await fixture('../test/fixtures/noto-sans-sc-subset/NotoSansSC-TestSubset.ttf'),
      'noto.ttf',
    );
    expect(cjk.coverage.filter((codePoint) => codePoint >= 0x4e00).length).toBeGreaterThan(0);
    expect(classifyFontScript(cjk.coverage)).toBe('cjk');
    expect(cjk.monospace).toBe(false);
    const cff = inspect(
      await fixture('../test/fixtures/source-serif-4/SourceSerif4-Regular.otf'),
      'serif.otf',
    );
    expect(cff.glyphCosts.outlineBytes.filter((bytes) => bytes > 0).length).toBeGreaterThan(100);
    expect(cff.layoutFeatures).toContain('kern');
    expect(cff.license).toContain('SIL Open Font License');
  });

  it('读取可变轴、命名实例与 gvar 体积', async () => {
    const inspection = inspect(
      await fixture('../test/fixtures/source-serif-4/SourceSerif4Variable-TestSubset.ttf'),
      'SourceSerif4Variable.ttf',
    );
    expect(inspection.variable).toBe(true);
    expect(inspection.variationAxes.map((axis) => axis.tag)).toEqual(['wght', 'opsz']);
    expect(inspection.variationInstances).toHaveLength(30);
    expect(inspection.variationInstances.find((instance) => instance.isDefault)).toMatchObject({
      coordinates: { wght: 400, opsz: 20 },
    });
    expect(inspection.glyphCosts.variationBytes?.some((bytes) => bytes > 0)).toBe(true);
  });

  it('检测彩色字体表', async () => {
    const inspection = inspect(
      await fixture('../test/fixtures/color-font/samples-glyf_colr_1.ttf'),
      'color.ttf',
    );
    expect(inspection.colorTables).toContain('colr');
    expect(inspection.warnings).toContainEqual({ code: 'color-font', tables: ['colr'] });
  });
});
