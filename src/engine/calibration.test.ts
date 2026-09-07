import { describe, expect, it } from 'vitest';
import { fakeInspection } from '../core/test-support';
import { calibrateGlyphCosts } from './calibration';

const HAN = Array.from({ length: 1200 }, (_, index) => 0x4e00 + index);
const LATIN = Array.from({ length: 95 }, (_, index) => 0x20 + index);

function uncalibrated(coverage: readonly number[]) {
  return fakeInspection({
    coverage,
    glyphCosts: {
      outlineBytes: coverage.map((codePoint) => (codePoint < 0x3000 ? 90 : 300 + (codePoint % 97))),
      ratio: 0.42,
      overhead: 2400,
      calibrated: false,
    },
  });
}

/** 模拟 WOFF2：连续码点压缩到 0.8 倍，拉丁字母带 1.5 倍布局数据。 */
function simulatedMeasure(inspection: ReturnType<typeof uncalibrated>, samples: number[][]) {
  const rawOf = new Map(
    inspection.coverage.map((codePoint, index) => [
      codePoint,
      inspection.glyphCosts.outlineBytes[index] ?? 0,
    ]),
  );
  return (codePoints: readonly number[]) => {
    samples.push([...codePoints]);
    const raw = codePoints.reduce((total, codePoint) => total + (rawOf.get(codePoint) ?? 0), 0);
    const first = codePoints[0] ?? 0;
    const last = codePoints.at(-1) ?? 0;
    const contiguous = codePoints.length > 1 && last - first === codePoints.length - 1;
    const scale = first < 0x3000 ? 1.5 : contiguous ? 0.8 : 1;
    return Promise.resolve(1800 + 0.37 * scale * raw);
  };
}

describe('calibrateGlyphCosts', () => {
  it('从实测中恢复压缩比例、固定开销、连续码点系数与基础字符系数', async () => {
    const inspection = uncalibrated([...LATIN, ...HAN]);
    const samples: number[][] = [];
    const result = await calibrateGlyphCosts(inspection, simulatedMeasure(inspection, samples));

    expect(samples.map((sample) => sample.length)).toEqual([1, 240, 240, 95]);
    expect(
      samples
        .slice(0, 3)
        .flat()
        .every((codePoint) => codePoint >= 0x4e00),
    ).toBe(true);
    const costs = result.glyphCosts;
    expect(costs.calibrated).toBe(true);
    expect(costs.ratio).toBeCloseTo(0.37, 6);
    expect(costs.overhead).toBeCloseTo(1800, 3);
    expect(costs.runScale).toBeCloseTo(0.8, 6);
    expect(costs.baseScale).toBeCloseTo(1.5, 6);
  });

  it('长尾太少时只校准比例与基础字符系数', async () => {
    const inspection = uncalibrated([...LATIN, ...HAN.slice(0, 20)]);
    const result = await calibrateGlyphCosts(inspection, simulatedMeasure(inspection, []));
    expect(result.glyphCosts.calibrated).toBe(true);
    expect(result.glyphCosts.runScale).toBeUndefined();
    expect(result.glyphCosts.familyRunScales).toBeUndefined();
    expect(result.glyphCosts.baseScale).toBeDefined();
  });

  it('西文字体按文字分组分别实测连续码点系数', async () => {
    const range = (start: number, end: number) =>
      Array.from({ length: end - start + 1 }, (_, index) => start + index);
    const greek = range(0x391, 0x3c9);
    const cyrillic = range(0x410, 0x44f);
    const box = range(0x2500, 0x257f);
    const inspection = uncalibrated([...LATIN, ...greek, ...cyrillic, ...box]);
    // 模拟：制表符压缩极好、希腊次之、西里尔最差。
    const scaleOf = (codePoint: number) =>
      codePoint >= 0x2500 ? 0.3 : codePoint >= 0x400 ? 0.9 : codePoint >= 0x370 ? 0.6 : 1;
    const samples: number[][] = [];
    const result = await calibrateGlyphCosts(inspection, (codePoints) => {
      samples.push([...codePoints]);
      return Promise.resolve(
        1800 + codePoints.reduce((total, codePoint) => total + 0.37 * 90 * scaleOf(codePoint), 0),
      );
    });
    const families = result.glyphCosts.familyRunScales ?? {};
    expect(Object.keys(families).sort()).toEqual(['1', '2', '4']);
    expect(families['4']).toBeLessThan(families['1'] ?? 0);
    expect(families['1']).toBeLessThan(families['2'] ?? 0);
    expect(samples).toContainEqual(box);
    expect(result.glyphCosts.runScale).toBeDefined();
  });

  it('字符太少或实测不可信时保留默认估算', async () => {
    const tiny = uncalibrated(LATIN.slice(0, 5));
    await expect(calibrateGlyphCosts(tiny, () => Promise.resolve(1000))).resolves.toBe(tiny);

    const inspection = uncalibrated([...LATIN, ...HAN]);
    const flat = await calibrateGlyphCosts(inspection, () => Promise.resolve(2000));
    expect(flat).toBe(inspection);
  });
});
