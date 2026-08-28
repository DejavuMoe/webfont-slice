import { describe, expect, it } from 'vitest';
import { corpusCoverage, createUsageModel, EMPTY_FREQUENCY, parseFrequencyData } from './frequency';
import { evaluateShards, pageProfile, profileMetrics } from './plan-metrics';
import { textStatistics } from './text-extract';

const raw = {
  version: 2,
  source: 'test',
  sourceUrl: 'https://example.com',
  corpusTotal: 100,
  profiles: {
    hans: { chars: '的一是', counts: [50, 30, 20] },
    hant: { chars: '的一為', counts: [50, 30, 20] },
  },
};

describe('字频模型', () => {
  it('解析紧凑的 v2 字频', () => {
    const data = parseFrequencyData(raw);
    expect(data.profiles.hans.codePoints).toEqual([0x7684, 0x4e00, 0x662f]);
    expect(data.profiles.hant.counts).toEqual([50, 30, 20]);
    expect(() => parseFrequencyData({ ...raw, version: 1 })).toThrow();
    expect(() =>
      parseFrequencyData({
        ...raw,
        profiles: { hans: { chars: '的', counts: [1, 2] }, hant: raw.profiles.hant },
      }),
    ).toThrow();
  });

  it('语料外字符获得平滑概率且排在长尾', () => {
    const usage = createUsageModel(parseFrequencyData(raw), 'hans');
    expect(usage.probability(0x7684)).toBeCloseTo(0.5);
    expect(usage.isRanked(0x7684)).toBe(true);
    expect(usage.isRanked(0x9f98)).toBe(false);
    expect(usage.probability(0x9f98)).toBeGreaterThan(0);
    expect(usage.probability(0x9f98)).toBeLessThan(usage.probability(0x662f));
  });

  it('用户正文按长度混入并让其用字变为有序', () => {
    const text = '龘'.repeat(3000);
    const usage = createUsageModel(parseFrequencyData(raw), 'hans', textStatistics(text));
    expect(usage.customWeight).toBeGreaterThan(0);
    expect(usage.customWeight).toBeLessThanOrEqual(0.4);
    expect(usage.isRanked(0x9f98)).toBe(true);
    expect(usage.probability(0x9f98)).toBeGreaterThan(usage.probability(0x662f));
    const short = createUsageModel(parseFrequencyData(raw), 'hans', textStatistics('龘'));
    expect(short.customWeight).toBe(0);
  });

  it('语料覆盖率与空数据退化', () => {
    const data = parseFrequencyData(raw);
    expect(corpusCoverage([0x7684, 0x4e00], data, 'hans')).toBeCloseTo(0.8);
    expect(corpusCoverage([0x70ba], data, 'hant')).toBeCloseTo(0.2);
    expect(corpusCoverage([0x7684], EMPTY_FREQUENCY, 'hans')).toBe(0);
  });
});

describe('分包指标', () => {
  it('期望请求数与期望字节按页面长度计算', () => {
    const metrics = evaluateShards([
      { kind: 'base', mass: 0, bytes: 1000 },
      { kind: 'ranked', mass: 0.01, bytes: 4000 },
      { kind: 'tail', mass: 0, bytes: 9000 },
    ]);
    expect(metrics.shardCount).toBe(3);
    expect(metrics.totalBytes).toBe(14000);
    const article = profileMetrics(metrics, 'article');
    expect(article.expectedRequests).toBeGreaterThan(1.99);
    expect(article.expectedRequests).toBeLessThan(2.01);
    expect(article.expectedBytes).toBeCloseTo(5000, -1);
    expect(pageProfile('headline').tokens).toBeLessThan(pageProfile('longform').tokens);
  });
});
