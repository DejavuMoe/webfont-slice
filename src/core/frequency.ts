/** 字频文本画像：简体语料或由 OpenCC 映射推导的繁体语料。 */
export type TextProfile = 'hans' | 'hant';

export interface FrequencyProfile {
  /** 按频次降序排列的码点。 */
  readonly codePoints: readonly number[];
  readonly counts: readonly number[];
}

export interface FrequencyData {
  readonly version: 2;
  readonly source: string;
  readonly sourceUrl: string;
  readonly corpusTotal: number;
  readonly profiles: Readonly<Record<TextProfile, FrequencyProfile>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProfile(value: unknown, name: string): FrequencyProfile {
  if (!isRecord(value) || typeof value.chars !== 'string' || !Array.isArray(value.counts)) {
    throw new Error(`字频画像 ${name} 格式无效`);
  }
  const codePoints = Array.from(value.chars).map((character) => character.codePointAt(0) ?? 0);
  const counts = value.counts.map((count: unknown) => {
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
      throw new Error(`字频画像 ${name} 含无效计数`);
    }
    return count;
  });
  if (codePoints.length !== counts.length) throw new Error(`字频画像 ${name} 长度不一致`);
  return { codePoints, counts };
}

export function parseFrequencyData(value: unknown): FrequencyData {
  if (
    !isRecord(value) ||
    value.version !== 2 ||
    typeof value.source !== 'string' ||
    typeof value.sourceUrl !== 'string' ||
    typeof value.corpusTotal !== 'number' ||
    !(value.corpusTotal > 0) ||
    !isRecord(value.profiles)
  ) {
    throw new Error('字频数据格式无效');
  }
  return {
    version: 2,
    source: value.source,
    sourceUrl: value.sourceUrl,
    corpusTotal: value.corpusTotal,
    profiles: {
      hans: parseProfile(value.profiles.hans, 'hans'),
      hant: parseProfile(value.profiles.hant, 'hant'),
    },
  };
}

/** 没有字频数据时的退化模型：全部视为长尾，按码点排序。 */
export const EMPTY_FREQUENCY: FrequencyData = {
  version: 2,
  source: 'none',
  sourceUrl: '',
  corpusTotal: 1,
  profiles: {
    hans: { codePoints: [], counts: [] },
    hant: { codePoints: [], counts: [] },
  },
};

/**
 * 字符使用模型：给出任一码点在一段随机正文中作为单个字符出现的概率。
 *
 * - 语料内字符按语料频次；
 * - 若用户提供了自己的正文，按正文长度把用户字频混入（最多 40%），
 *   让站点真实用字排进更靠前的分片；
 * - 语料外字符赋予极小的平滑概率 ε，保证长尾字符也会被均衡切分而不是并成巨片。
 */
export interface UsageModel {
  readonly profile: TextProfile;
  readonly probability: (codePoint: number) => number;
  /** 是否有语料或用户正文支撑（决定按频次还是按码点排序）。 */
  readonly isRanked: (codePoint: number) => boolean;
  /** 仅语料部分的概率，用于报告"常用字频次覆盖率"。 */
  readonly corpusProbability: (codePoint: number) => number;
  readonly customWeight: number;
}

export interface CustomTextStatistics {
  readonly counts: ReadonlyMap<number, number>;
  readonly total: number;
}

export function createUsageModel(
  frequency: FrequencyData,
  profile: TextProfile,
  custom?: CustomTextStatistics,
): UsageModel {
  const table = frequency.profiles[profile];
  const total = frequency.corpusTotal;
  const corpus = new Map<number, number>();
  table.codePoints.forEach((codePoint, index) => {
    corpus.set(codePoint, (table.counts[index] ?? 0) / total);
  });
  const epsilon = 0.25 / total;
  const customTotal = custom?.total ?? 0;
  const customWeight = customTotal >= 200 ? Math.min(0.4, customTotal / (customTotal + 6000)) : 0;
  const customCounts = custom?.counts;

  return {
    profile,
    customWeight,
    corpusProbability: (codePoint) => corpus.get(codePoint) ?? 0,
    isRanked: (codePoint) =>
      corpus.has(codePoint) || (customWeight > 0 && (customCounts?.has(codePoint) ?? false)),
    probability: (codePoint) => {
      const base = corpus.get(codePoint) ?? 0;
      const own = customWeight > 0 ? (customCounts?.get(codePoint) ?? 0) / customTotal : 0;
      const blended = (1 - customWeight) * base + customWeight * own;
      return blended > 0 ? blended : epsilon;
    },
  };
}

/** 选中码点在语料中覆盖的字符频次比例（0–1）。 */
export function corpusCoverage(
  codePoints: Iterable<number>,
  frequency: FrequencyData,
  profile: TextProfile,
): number {
  const selected = new Set(codePoints);
  const table = frequency.profiles[profile];
  let covered = 0;
  let all = 0;
  table.codePoints.forEach((codePoint, index) => {
    const count = table.counts[index] ?? 0;
    all += count;
    if (selected.has(codePoint)) covered += count;
  });
  return all === 0 ? 0 : covered / all;
}
