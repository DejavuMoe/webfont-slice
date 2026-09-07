import type { FontInspection } from '../core/font-inspection';
import { isBaseCodePoint, scriptFamily } from '../core/shard-planner';
import { isHanCodePoint } from '../core/text-extract';

/** 把一组码点子集化并编码为 WOFF2，返回字节数。 */
export type MeasureWoff2 = (codePoints: readonly number[]) => Promise<number>;

const SAMPLE_SIZE = 240;
const MIN_BASE_SAMPLE = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 西文字体整款几乎都是长尾，不大时直接整体实测。 */
const WHOLE_TAIL_LIMIT = 2000;

function nonBaseIndices(coverage: readonly number[]): number[] {
  const indices: number[] = [];
  coverage.forEach((codePoint, index) => {
    if (!isBaseCodePoint(codePoint)) indices.push(index);
  });
  return indices;
}

/**
 * 求 runScale 用的连续码点样本。CJK 字体取汉字中段 240 个；西文字体的长尾
 * 横跨重音字母、希腊、西里尔、制表符与图标，组合字形与相似字形压缩差异很大，
 * 字符不多时整体实测，否则取中段 4 倍样本。
 */
function runSample(pool: readonly number[], han: boolean): number[] {
  if (!han && pool.length <= WHOLE_TAIL_LIMIT) return [...pool];
  const size = han ? SAMPLE_SIZE : SAMPLE_SIZE * 4;
  const from = Math.max(0, Math.floor(pool.length / 2) - (han ? 0 : size / 2));
  return pool.slice(from, from + size);
}

/**
 * 用少量实测子集化校准体积模型 `woff2 ≈ overhead + ratio · raw`：
 *
 * 1. 单字与均匀取样约 240 字求出 `overhead` 与 `ratio`（随机分布，对应按字频切出的分片）；
 * 2. 连续码点求 `runScale`：按部首排列的相邻字形共享部件，压缩更好，对应长尾片；
 *    西文字体再按文字分组各测一次（`familyRunScales`），因为长尾按文字分片；
 * 3. 字体自带的基础字符（拉丁字母与标点）求 `baseScale`：它们带有字距等布局数据。
 *
 * 样本优先取汉字，因为 CJK 字体的体积几乎全部来自汉字字形。
 */
export async function calibrateGlyphCosts(
  inspection: FontInspection,
  measure: MeasureWoff2,
): Promise<FontInspection> {
  const { coverage, glyphCosts } = inspection;
  if (coverage.length < 8) return inspection;
  const raw = (index: number) =>
    (glyphCosts.outlineBytes[index] ?? 0) + (glyphCosts.variationBytes?.[index] ?? 0);
  const rawOf = (indices: readonly number[]) =>
    indices.reduce((total, index) => total + raw(index), 0);
  const codePointsOf = (indices: readonly number[]) => indices.map((index) => coverage[index] ?? 0);

  const hanIndices: number[] = [];
  const baseIndices: number[] = [];
  coverage.forEach((codePoint, index) => {
    if (isHanCodePoint(codePoint)) hanIndices.push(index);
    else if (isBaseCodePoint(codePoint)) baseIndices.push(index);
  });
  const hanPool = hanIndices.length >= SAMPLE_SIZE * 2;
  const pool = hanPool ? hanIndices : coverage.map((_, index) => index);
  const sampleSize = Math.min(SAMPLE_SIZE, pool.length);
  const step = pool.length / sampleSize;
  const sample: number[] = [];
  for (let position = 0; position < sampleSize; position += 1) {
    sample.push(pool[Math.floor(position * step)] ?? 0);
  }
  const single = [pool[Math.floor(pool.length / 2)] ?? 0];
  const smallBytes = await measure(codePointsOf(single));
  const largeBytes = await measure(codePointsOf(sample));
  const smallRaw = rawOf(single);
  const largeRaw = rawOf(sample);
  if (largeRaw <= smallRaw) return inspection;
  const ratio = (largeBytes - smallBytes) / (largeRaw - smallRaw);
  if (!Number.isFinite(ratio) || ratio <= 0.02 || ratio > 2) return inspection;
  const overhead = Math.max(300, smallBytes - ratio * smallRaw);

  /** 一组字形实测体积相对 `ratio · raw` 的系数；样本太小时不测。 */
  const scaleOf = async (indices: readonly number[], min: number, max: number) => {
    const sampleRaw = rawOf(indices);
    if (indices.length < MIN_BASE_SAMPLE || sampleRaw <= 0) return undefined;
    const bytes = await measure(codePointsOf(indices));
    return clamp((bytes - overhead) / (ratio * sampleRaw), min, max);
  };

  const tail = hanPool ? hanIndices : nonBaseIndices(coverage);
  const runScale = await scaleOf(runSample(tail, hanPool), 0.5, 1.2);

  // 西文字体的长尾按文字分片，各文字的压缩率差别很大（重音组合字形、盲文、图标），分别实测。
  let familyRunScales: Record<string, number> | undefined;
  if (!hanPool) {
    const families = new Map<number, number[]>();
    for (const index of tail) {
      const family = scriptFamily(coverage[index] ?? 0);
      const list = families.get(family);
      if (list === undefined) families.set(family, [index]);
      else list.push(index);
    }
    if (families.size > 1) {
      familyRunScales = {};
      for (const [family, indices] of families) {
        const scale = await scaleOf(runSample(indices, false), 0.25, 2);
        if (scale !== undefined) familyRunScales[String(family)] = scale;
      }
    }
  }

  const baseScale = await scaleOf(baseIndices, 0.5, 3);

  return {
    ...inspection,
    glyphCosts: {
      ...glyphCosts,
      ratio,
      overhead,
      calibrated: true,
      ...(runScale === undefined ? {} : { runScale }),
      ...(familyRunScales === undefined ? {} : { familyRunScales }),
      ...(baseScale === undefined ? {} : { baseScale }),
    },
  };
}
