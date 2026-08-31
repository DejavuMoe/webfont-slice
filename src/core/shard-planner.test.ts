import { describe, expect, it } from 'vitest';
import { createUsageModel, EMPTY_FREQUENCY, type FrequencyData } from './frequency';
import { evaluateShards } from './plan-metrics';
import {
  DEFAULT_PLAN_SETTINGS,
  estimateSingleFileBytes,
  isBaseCodePoint,
  planShards,
  scriptFamily,
  shardLoadProbability,
  type CostModel,
  type PlanSettings,
  type PlannedShard,
} from './shard-planner';

/** 合成的齐夫分布语料：码点越小越常用。 */
function zipfFrequency(size: number, start = 0x4e00): FrequencyData {
  const codePoints = Array.from({ length: size }, (_, index) => start + index);
  const counts = codePoints.map((_, index) => Math.round(1_000_000 / (index + 1)));
  return {
    version: 2,
    source: 'test',
    sourceUrl: '',
    corpusTotal: counts.reduce((total, count) => total + count, 0),
    profiles: { hans: { codePoints, counts }, hant: { codePoints: [], counts: [] } },
  };
}

const costs: CostModel = { overhead: 1500, cost: (codePoint) => (codePoint < 0x3000 ? 60 : 200) };
const ascii = Array.from({ length: 95 }, (_, index) => 0x20 + index);
const han = Array.from({ length: 6000 }, (_, index) => 0x4e00 + index);
const available = [...ascii, 0x3001, 0x3002, ...han];
const usage = createUsageModel(zipfFrequency(3000), 'hans');

function settings(patch: Partial<PlanSettings>): PlanSettings {
  return { ...DEFAULT_PLAN_SETTINGS, ...patch };
}

function flatten(plan: ReturnType<typeof planShards>): number[] {
  return plan.shards.flatMap((shard) => shard.codePoints);
}

describe('分包规划', () => {
  it('长尾跨入另一种文字时在够大的片处切开（西文与代码字体）', () => {
    const range = (start: number, end: number) =>
      Array.from({ length: end - start + 1 }, (_, index) => start + index);
    const western = [
      ...ascii,
      ...range(0x100, 0x24f),
      ...range(0x370, 0x3ff),
      ...range(0x400, 0x4ff),
      ...range(0x2500, 0x257f),
      ...range(0xe000, 0xe3ff),
    ];
    const plan = planShards(
      western,
      createUsageModel(EMPTY_FREQUENCY, 'hans'),
      costs,
      settings({ granularity: 4 }),
    );
    expect(flatten(plan).sort((a, b) => a - b)).toEqual(western);
    const families = plan.shards
      .filter((shard) => shard.kind === 'tail')
      .map((shard) => new Set(shard.codePoints.map(scriptFamily)));
    // 希腊与西里尔不同片；私用区图标不与任何文字同片。
    expect(
      families.some((set) => set.has(scriptFamily(0x3b1)) && set.has(scriptFamily(0x430))),
    ).toBe(false);
    const icon = scriptFamily(0xe000);
    expect(families.filter((set) => set.has(icon)).every((set) => set.size === 1)).toBe(true);
    expect(families.filter((set) => set.has(icon)).length).toBeGreaterThan(1);
  });

  it('每个可用码点恰好出现一次', () => {
    for (const strategy of ['smart', 'single'] as const) {
      const plan = planShards(available, usage, costs, settings({ strategy }));
      const all = flatten(plan);
      expect(all).toHaveLength(available.length);
      expect(new Set(all).size).toBe(available.length);
    }
  });

  it('基础字符单独成片并预加载', () => {
    const plan = planShards(available, usage, costs, settings({}));
    const [base] = plan.shards;
    expect(base?.kind).toBe('base');
    expect(base?.key).toBe('base');
    expect(base?.preload).toBe(true);
    expect(base?.codePoints.every(isBaseCodePoint)).toBe(true);
    expect(base?.codePoints).toContain(0x41);
    expect(base?.codePoints).toContain(0x3002);
  });

  it('智能模式：高频字在前、长尾按码点连续、单片不超过上限', () => {
    const plan = planShards(
      available,
      usage,
      costs,
      settings({ strategy: 'smart', granularity: 4 }),
    );
    const content = plan.shards.filter((shard) => shard.kind !== 'base');
    expect(content[0]?.codePoints).toContain(0x4e00);
    expect(content[0]?.kind).toBe('ranked');
    const tail = content.filter((shard) => shard.kind === 'tail');
    expect(tail.length).toBeGreaterThan(0);
    for (const shard of tail) {
      const first = shard.codePoints[0] ?? 0;
      const last = shard.codePoints.at(-1) ?? 0;
      expect(last - first + 1).toBe(shard.codePoints.length);
      expect(first).toBeGreaterThanOrEqual(0x4e00 + 3000);
    }
    for (const shard of content) expect(shard.estimatedBytes).toBeLessThanOrEqual(128 * 1024 + 200);
    const keys = plan.shards.map((shard) => shard.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('粒度越粗片数越少', () => {
    const counts = [1, 4, 7].map(
      (granularity) => planShards(available, usage, costs, settings({ granularity })).shards.length,
    );
    expect(counts[0]).toBeGreaterThan(counts[1] ?? 0);
    expect(counts[1]).toBeGreaterThan(counts[2] ?? 0);
  });

  it('智能模式的期望流量优于等量切分', () => {
    const smart = planShards(available, usage, costs, settings({ strategy: 'smart' }));
    // 对照组：同样片数，按使用概率降序后等字节切分。
    const ordered = [...available].sort(
      (left, right) => usage.probability(right) - usage.probability(left) || left - right,
    );
    const perShard = Math.ceil(ordered.length / smart.shards.length);
    const count = {
      shards: Array.from({ length: smart.shards.length }, (_, index) => {
        const codePoints = ordered.slice(index * perShard, (index + 1) * perShard);
        return {
          kind: 'ranked' as const,
          mass: codePoints.reduce((total, codePoint) => total + usage.probability(codePoint), 0),
          estimatedBytes:
            costs.overhead +
            codePoints.reduce((total, codePoint) => total + costs.cost(codePoint), 0),
        };
      }),
    };
    const measure = (plan: {
      shards: readonly Pick<PlannedShard, 'kind' | 'mass' | 'estimatedBytes'>[];
    }) =>
      evaluateShards(
        plan.shards.map((shard) => ({
          kind: shard.kind,
          mass: shard.mass,
          bytes: shard.estimatedBytes,
        })),
      ).profiles.find((profile) => profile.id === 'article')?.expectedBytes ?? 0;
    expect(measure(smart)).toBeLessThan(measure(count));
  });

  it('连续码点与基础字符的体积系数分别作用于长尾片、基础片和单文件', () => {
    const scaled: CostModel = { ...costs, runScale: 0.5, baseScale: 2 };
    const plain = planShards(available, usage, costs, settings({}));
    const plan = planShards(available, usage, scaled, settings({}));
    const glyphBytes = (shard: (typeof plan.shards)[number]) =>
      shard.estimatedBytes - costs.overhead;
    const base = (shards: typeof plan.shards) => shards.find((shard) => shard.kind === 'base');
    const plainBase = base(plain.shards);
    const scaledBase = base(plan.shards);
    expect(plainBase && scaledBase && glyphBytes(scaledBase) / glyphBytes(plainBase)).toBeCloseTo(
      2,
      2,
    );

    const tail = plan.shards.filter((shard) => shard.kind === 'tail');
    expect(tail.length).toBeGreaterThan(0);
    for (const shard of tail) {
      const unscaled = shard.codePoints.reduce(
        (total, codePoint) => total + costs.cost(codePoint),
        0,
      );
      expect(glyphBytes(shard)).toBeCloseTo(unscaled * 0.5, 0);
    }
    // 同样的装箱目标下，压缩更好的长尾装进更多字、片数更少。
    expect(tail.length).toBeLessThan(plain.shards.filter((shard) => shard.kind === 'tail').length);
    for (const shard of plan.shards.filter((candidate) => candidate.kind === 'ranked')) {
      const unscaled = shard.codePoints.reduce(
        (total, codePoint) => total + costs.cost(codePoint),
        0,
      );
      expect(glyphBytes(shard)).toBeCloseTo(unscaled, 0);
    }

    const [single] = planShards(available, usage, scaled, settings({ strategy: 'single' })).shards;
    const expected = available.reduce(
      (total, codePoint) => total + costs.cost(codePoint) * (isBaseCodePoint(codePoint) ? 2 : 0.5),
      0,
    );
    expect(single && glyphBytes(single)).toBeCloseTo(expected, 0);
  });

  it('单文件估算与单文件方案一致，超过 1 MiB 后按整字体压缩收益折减', () => {
    const [single] = planShards(available, usage, costs, settings({ strategy: 'single' })).shards;
    expect(estimateSingleFileBytes(available, usage, costs)).toBe(single?.estimatedBytes);
    expect(estimateSingleFileBytes([], usage, costs)).toBe(0);

    const heavy: CostModel = { overhead: 0, cost: () => 1024 };
    const small = Array.from({ length: 1000 }, (_, index) => 0x4e00 + index);
    const large = Array.from({ length: 8192 }, (_, index) => 0x4e00 + index);
    expect(estimateSingleFileBytes(small, usage, heavy)).toBe(1000 * 1024);
    const scaled = estimateSingleFileBytes(large, usage, heavy);
    expect(scaled).toBeLessThan(8 * 1024 * 1024);
    expect(scaled).toBeCloseTo(8 * 1024 * 1024 * 8 ** -0.1, -3);
  });

  it('空集合返回空计划', () => {
    expect(planShards([], usage, costs, DEFAULT_PLAN_SETTINGS).shards).toEqual([]);
  });

  it('加载概率：基础片恒为 1，内容片随页面长度增加', () => {
    expect(shardLoadProbability({ kind: 'base', mass: 0 }, 10)).toBe(1);
    const short = shardLoadProbability({ kind: 'ranked', mass: 0.001 }, 300);
    const long = shardLoadProbability({ kind: 'ranked', mass: 0.001 }, 6000);
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(1);
  });
});
