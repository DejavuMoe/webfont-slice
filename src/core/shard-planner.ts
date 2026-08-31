import type { CodePointList } from './codepoints';
import type { UsageModel } from './frequency';

/**
 * 分包规划器。
 *
 * 模型：一页正文可视为从字符使用分布中抽取 L 个字符。某分片包含的字符
 * 概率质量为 m 时，它在该页被下载的概率约为 1 − e^(−L·m)（泊松近似）。
 *
 * 智能模式（smart）把"有字频依据"的字符按使用概率降序排成序列，用动态
 * 规划求连续切分，最小化
 *
 *   Σ [ P_L(m)·(固定开销 + 字形字节 + 请求成本)          首页期望代价
 *     + w·P_{8L}(m)·(固定开销 + 字形字节)                  同一访客后续浏览的累计下载
 *     + CSS 成本 ]                                        每条 @font-face 的常驻成本
 *
 * 并约束单片大小落在粒度档位的 [min, max] 内。结果呈现为：几乎每页都会
 * 加载的高频区合并为少量大片（减少请求），中频过渡区切细（减少浪费）。
 * 语料外的长尾字符按文字分组、再按码点顺序装箱，使 `unicode-range` 压缩成少量
 * 连续区间；跨入另一种文字（希腊、西里尔、符号、私用区图标……）时在够大的片处切开。
 * 西文与代码字体几乎全是长尾，因此按文字分片。
 *
 * 基础字符（ASCII、常用中西文标点）几乎出现在每一页，单独成片并建议预加载。
 * 单文件模式把全部字符打成一个文件，适合只有少量文字的标题与 Logo。
 */

export type ShardStrategy = 'smart' | 'single';

export interface PlanSettings {
  readonly strategy: ShardStrategy;
  /** 粒度，1（最省流量）… 7（最少文件）。 */
  readonly granularity: number;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  strategy: 'smart',
  granularity: 4,
};

export const GRANULARITY_LEVELS = 7;

interface GranularityParameters {
  /** 每多一个请求折算的字节成本。 */
  readonly requestCost: number;
  /** 单片下限：避免固定开销占比过高的碎片。 */
  readonly minBytes: number;
  /** 单片上限：高频片即使总会加载也不无限合并，保证渐进渲染。 */
  readonly maxBytes: number;
  /** 长尾（无字频依据）字符的装箱大小。 */
  readonly tailBytes: number;
}

const KB = 1024;
const GRANULARITY: readonly GranularityParameters[] = [
  { requestCost: 1024, minBytes: 10 * KB, maxBytes: 52 * KB, tailBytes: 32 * KB },
  { requestCost: 2048, minBytes: 13 * KB, maxBytes: 72 * KB, tailBytes: 40 * KB },
  { requestCost: 3072, minBytes: 16 * KB, maxBytes: 96 * KB, tailBytes: 48 * KB },
  { requestCost: 6144, minBytes: 24 * KB, maxBytes: 128 * KB, tailBytes: 72 * KB },
  { requestCost: 12288, minBytes: 32 * KB, maxBytes: 176 * KB, tailBytes: 112 * KB },
  { requestCost: 24576, minBytes: 48 * KB, maxBytes: 256 * KB, tailBytes: 160 * KB },
  { requestCost: 49152, minBytes: 72 * KB, maxBytes: 384 * KB, tailBytes: 224 * KB },
];

const BALANCED: GranularityParameters = {
  requestCost: 6144,
  minBytes: 24 * KB,
  maxBytes: 128 * KB,
  tailBytes: 72 * KB,
};

/** 每个分片在 CSS 中的常驻成本（gzip 后的一条 @font-face），所有页面都会下载。 */
const PER_SHARD_CSS_COST = 96;

/** 规划所依据的典型页面长度（字符数）。 */
export const DESIGN_PAGE_TOKENS = 1500;

/**
 * 只看首页会把过渡区切成大量几字一片的碎片（独立抽样假设低估了字符共现）。
 * 计入同一访客随后浏览若干页的累计下载，中频区会合并成更合理的大小。
 */
const SESSION_PAGES = 8;
const SESSION_WEIGHT = 0.3;

export interface CostModel {
  /** 每个分片文件的固定开销（WOFF2 头与非字形表）。 */
  readonly overhead: number;
  /** 单个码点字形压缩后的估算字节数（按随机取样校准）。 */
  readonly cost: (codePoint: number) => number;
  /** 按码点连续装箱时的体积系数：相邻码点字形相似，压缩得更好。默认 1。 */
  readonly runScale?: number;
  /** 按码点给出连续装箱系数（西文字体各文字分别校准）；未提供时用 `runScale`。 */
  readonly runScaleFor?: (codePoint: number) => number | undefined;
  /** 基础片（拉丁字母与标点，带字距等布局数据）的体积系数。默认 1。 */
  readonly baseScale?: number;
}

export type ShardKind = 'base' | 'ranked' | 'tail' | 'single';

export interface PlannedShard {
  readonly key: string;
  readonly kind: ShardKind;
  /** 升序码点。 */
  readonly codePoints: readonly number[];
  readonly estimatedBytes: number;
  /** 片内字符使用概率之和。 */
  readonly mass: number;
  readonly preload: boolean;
}

export interface ShardPlan {
  readonly shards: readonly PlannedShard[];
}

const BASE_EXPLICIT = new Set([
  0x00a0, 0x00a9, 0x00ab, 0x00ae, 0x00b0, 0x00b1, 0x00b7, 0x00bb, 0x00d7, 0x00f7, 0x2030, 0x2032,
  0x2033, 0x203b, 0x2103, 0x2116, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x25a0, 0x25a1, 0x25cb,
  0x25cf, 0x2605, 0x2606, 0x3000,
]);

/** 几乎每个中文页面都会出现的非汉字字符。 */
export function isBaseCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0x2010 && codePoint <= 0x2027) ||
    (codePoint >= 0x3001 && codePoint <= 0x3011) ||
    (codePoint >= 0x3014 && codePoint <= 0x301f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff0f) ||
    (codePoint >= 0xff1a && codePoint <= 0xff20) ||
    (codePoint >= 0xff3b && codePoint <= 0xff40) ||
    (codePoint >= 0xff5b && codePoint <= 0xff65) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe5) ||
    BASE_EXPLICIT.has(codePoint)
  );
}

export function shardLoadProbability(
  shard: Pick<PlannedShard, 'kind' | 'mass'>,
  tokens: number,
): number {
  if (shard.kind === 'base' || shard.kind === 'single') return 1;
  return 1 - Math.exp(-tokens * shard.mass);
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function scaleOf(value: number | undefined): number {
  return value === undefined ? 1 : Math.min(4, Math.max(0.25, positive(value, 1)));
}

function runScaleOf(costs: CostModel, codePoint: number): number {
  return scaleOf(costs.runScaleFor?.(codePoint) ?? costs.runScale);
}

/**
 * 单个字符在某类分片中的体积系数。长尾与单文件按码点顺序存放字形，
 * 享受相邻字形的压缩收益；有字频依据的分片是跨部首的散点，用校准值本身。
 */
function glyphScale(
  codePoint: number,
  kind: ShardKind,
  usage: UsageModel,
  costs: CostModel,
): number {
  if (kind === 'base') return scaleOf(costs.baseScale);
  if (kind === 'single') {
    return isBaseCodePoint(codePoint) ? scaleOf(costs.baseScale) : runScaleOf(costs, codePoint);
  }
  return usage.isRanked(codePoint) ? 1 : runScaleOf(costs, codePoint);
}

interface Sequence {
  readonly codePoints: Int32Array;
  readonly probability: Float64Array;
  readonly cost: Float64Array;
  /** 前 rankedCount 个字符有字频依据，其后为按码点排序的长尾。 */
  readonly rankedCount: number;
}

function buildSequence(
  codePoints: readonly number[],
  usage: UsageModel,
  costs: CostModel,
): Sequence {
  const entries = codePoints.map((codePoint) => ({
    codePoint,
    probability: usage.probability(codePoint),
    ranked: usage.isRanked(codePoint),
  }));
  entries.sort((left, right) => {
    if (left.ranked !== right.ranked) return left.ranked ? -1 : 1;
    if (left.ranked && left.probability !== right.probability) {
      return right.probability - left.probability;
    }
    // 长尾先按文字分组再按码点：越南文（U+1Exx）与拉丁、希腊文扩展与希腊排在一起。
    if (!left.ranked) {
      const family = scriptFamily(left.codePoint) - scriptFamily(right.codePoint);
      if (family !== 0) return family;
    }
    return left.codePoint - right.codePoint;
  });
  const length = entries.length;
  const sequence = {
    codePoints: new Int32Array(length),
    probability: new Float64Array(length),
    cost: new Float64Array(length),
    rankedCount: 0,
  };
  entries.forEach((entry, index) => {
    sequence.codePoints[index] = entry.codePoint;
    sequence.probability[index] = entry.probability;
    sequence.cost[index] = Math.max(
      1,
      costs.cost(entry.codePoint) * (entry.ranked ? 1 : runScaleOf(costs, entry.codePoint)),
    );
    if (entry.ranked) sequence.rankedCount += 1;
  });
  return sequence;
}

/** 切分点（含首尾）：每段为 [cuts[k], cuts[k+1])。 */
type Cuts = number[];

/**
 * 长尾装箱时的文字分组。长尾没有字频依据，按码点顺序装箱；跨入另一种文字时
 * 只要当前片已不小就切开，让俄文页面只命中西里尔那几片、终端界面只命中
 * 制表符那几片，而不是顺带下载半片希腊文或图标。
 */
export function scriptFamily(codePoint: number): number {
  if (codePoint < 0x0370) return 0; // 拉丁（含 IPA、修饰符号、组合附加符号）
  if (codePoint < 0x0400) return 1; // 希腊文
  if (codePoint < 0x0530) return 2; // 西里尔文
  if (codePoint < 0x1e00) return 3; // 其他字母文字
  if (codePoint < 0x1f00) return 0; // 拉丁扩展附加（越南文）
  if (codePoint < 0x2000) return 1; // 希腊文扩展
  if (codePoint < 0x2e80) return 4; // 标点、符号、箭头、数学、制表符、盲文
  if (codePoint < 0xa000) return 5; // CJK 部首与符号、假名、注音、汉字
  if (codePoint < 0xac00) return 3; // 彝文、拉丁扩展 D 等
  if (codePoint < 0xe000) return 6; // 谚文
  if (codePoint < 0xf900) return 7; // 私用区（图标）
  if (codePoint < 0xfb00) return 5; // CJK 兼容表意文字
  if (codePoint < 0x10000) return 8; // 表现形式、半角与全角
  if (codePoint < 0x1f000) return 3; // 补充平面的字母文字
  if (codePoint < 0x20000) return 9; // 表情与符号
  if (codePoint < 0xf0000) return 5; // CJK 扩展 B 及以后
  return 7; // 补充私用区
}

function packBySize(
  sequence: Sequence,
  start: number,
  end: number,
  targetBytes: number,
  familyBytes: number,
  overhead: number,
): Cuts {
  const cuts = [start];
  let bytes = overhead;
  let family = -1;
  for (let index = start; index < end; index += 1) {
    const cost = sequence.cost[index] ?? 0;
    const next = scriptFamily(sequence.codePoints[index] ?? 0);
    if (
      index > (cuts.at(-1) ?? 0) &&
      (bytes + cost > targetBytes || (next !== family && bytes >= familyBytes))
    ) {
      cuts.push(index);
      bytes = overhead;
    }
    family = next;
    bytes += cost;
  }
  cuts.push(end);
  return cuts;
}

function optimizeRanked(
  sequence: Sequence,
  end: number,
  overhead: number,
  parameters: GranularityParameters,
): Cuts {
  if (end === 0) return [0];
  let totalBytes = 0;
  for (let index = 0; index < end; index += 1) totalBytes += sequence.cost[index] ?? 0;

  // 相邻字符聚成约 0.5–4 KB 的原子，把 DP 规模控制在约 2400 以内。
  const atomBytes = Math.min(4 * KB, Math.max(KB / 2, totalBytes / 2400));
  const atomStarts: number[] = [];
  let pending = atomBytes;
  for (let index = 0; index < end; index += 1) {
    if (pending >= atomBytes) {
      atomStarts.push(index);
      pending = 0;
    }
    pending += sequence.cost[index] ?? 0;
  }
  const atoms = atomStarts.length;
  const prefixBytes = new Float64Array(atoms + 1);
  const prefixMass = new Float64Array(atoms + 1);
  for (let atom = 0; atom < atoms; atom += 1) {
    const from = atomStarts[atom] ?? 0;
    const to = atom + 1 < atoms ? (atomStarts[atom + 1] ?? 0) : end;
    let bytes = 0;
    let mass = 0;
    for (let index = from; index < to; index += 1) {
      bytes += sequence.cost[index] ?? 0;
      mass += sequence.probability[index] ?? 0;
    }
    prefixBytes[atom + 1] = (prefixBytes[atom] ?? 0) + bytes;
    prefixMass[atom + 1] = (prefixMass[atom] ?? 0) + mass;
  }

  const best = new Float64Array(atoms + 1).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(atoms + 1);
  best[0] = 0;
  const sessionTokens = DESIGN_PAGE_TOKENS * SESSION_PAGES;
  const fixed = overhead + parameters.requestCost;
  for (let to = 1; to <= atoms; to += 1) {
    const toBytes = prefixBytes[to] ?? 0;
    const toMass = prefixMass[to] ?? 0;
    const isLast = to === atoms;
    for (let from = to - 1; from >= 0; from -= 1) {
      const bytes = toBytes - (prefixBytes[from] ?? 0);
      if (bytes + overhead > parameters.maxBytes && from < to - 1) break;
      if (bytes + overhead < parameters.minBytes && !isLast) continue;
      const before = best[from] ?? 0;
      if (before === Number.POSITIVE_INFINITY) continue;
      const mass = toMass - (prefixMass[from] ?? 0);
      const load = 1 - Math.exp(-DESIGN_PAGE_TOKENS * mass);
      const sessionLoad = 1 - Math.exp(-sessionTokens * mass);
      const candidate =
        before +
        load * (fixed + bytes) +
        SESSION_WEIGHT * sessionLoad * (overhead + bytes) +
        PER_SHARD_CSS_COST;
      if (candidate < (best[to] ?? 0)) {
        best[to] = candidate;
        previous[to] = from;
      }
    }
  }

  const atomCuts: number[] = [];
  for (let cursor = atoms; cursor > 0; cursor = previous[cursor] ?? 0) atomCuts.push(cursor);
  atomCuts.push(0);
  atomCuts.reverse();
  return atomCuts.map((atom) => (atom >= atoms ? end : (atomStarts[atom] ?? 0)));
}

/**
 * 整款字符放进一个文件时，Brotli 可以跨越全部字形寻找重复，体积明显小于
 * 分片之和。超过 1 MiB 后按幂律折减；在 Noto Sans SC VF、Noto Serif SC VF
 * 与等线的 17 个单文件（3.7k–31k 字）上实测，误差在 −4%～+7% 之间。
 */
const LARGE_FILE_BYTES = 1024 * 1024;
const LARGE_FILE_EXPONENT = 0.1;

function largeFileScale(bytes: number): number {
  return bytes <= LARGE_FILE_BYTES ? 1 : (bytes / LARGE_FILE_BYTES) ** -LARGE_FILE_EXPONENT;
}

function describeShard(
  codePoints: number[],
  kind: ShardKind,
  usage: UsageModel,
  costs: CostModel,
): Omit<PlannedShard, 'key' | 'preload'> {
  let glyphBytes = 0;
  let mass = 0;
  for (const codePoint of codePoints) {
    glyphBytes += Math.max(1, costs.cost(codePoint) * glyphScale(codePoint, kind, usage, costs));
    mass += usage.probability(codePoint);
  }
  if (kind === 'single') glyphBytes *= largeFileScale(glyphBytes);
  return {
    kind,
    codePoints: codePoints.sort((left, right) => left - right),
    estimatedBytes: Math.round(costs.overhead + glyphBytes),
    mass,
  };
}

const MAX_PRELOAD_FILES = 3;
const PRELOAD_THRESHOLD = 0.9;

function assignKeys(described: readonly Omit<PlannedShard, 'key' | 'preload'>[]): PlannedShard[] {
  const width = Math.max(2, String(described.length).length);
  let preloadBudget = MAX_PRELOAD_FILES;
  let contentIndex = 0;
  return described.map((shard): PlannedShard => {
    const preload =
      preloadBudget > 0 &&
      (shard.kind === 'base' ||
        shard.kind === 'single' ||
        (shard.kind === 'ranked' &&
          shardLoadProbability(shard, DESIGN_PAGE_TOKENS) >= PRELOAD_THRESHOLD));
    if (preload) preloadBudget -= 1;
    if (shard.kind === 'base') return { ...shard, key: 'base', preload };
    if (shard.kind === 'single') return { ...shard, key: 'all', preload };
    contentIndex += 1;
    return { ...shard, key: String(contentIndex).padStart(width, '0'), preload };
  });
}

export function planShards(
  available: CodePointList,
  usage: UsageModel,
  costs: CostModel,
  settings: PlanSettings,
): ShardPlan {
  if (available.length === 0) return { shards: [] };
  const overhead = positive(costs.overhead, 2048);

  if (settings.strategy === 'single') {
    return { shards: assignKeys([describeShard([...available], 'single', usage, costs)]) };
  }

  const base: number[] = [];
  const main: number[] = [];
  for (const codePoint of available) {
    (isBaseCodePoint(codePoint) ? base : main).push(codePoint);
  }

  const sequence = buildSequence(main, usage, costs);
  const length = main.length;
  let cuts: Cuts = [];
  if (length > 0) {
    const level = Math.min(GRANULARITY_LEVELS, Math.max(1, Math.round(settings.granularity)));
    const parameters = GRANULARITY[level - 1] ?? BALANCED;
    const ranked = optimizeRanked(sequence, sequence.rankedCount, overhead, parameters);
    // 一个页面很少同时用到两种非拉丁文字：除非当前片小到固定开销占大头，否则在文字边界切开。
    const tail = packBySize(
      sequence,
      sequence.rankedCount,
      length,
      parameters.tailBytes,
      Math.max(2 * overhead, parameters.minBytes / 4),
      overhead,
    );
    cuts = [...ranked.slice(0, -1), ...tail];
  }

  const described: Omit<PlannedShard, 'key' | 'preload'>[] = [];
  if (base.length > 0) described.push(describeShard(base, 'base', usage, costs));
  for (let segment = 0; segment + 1 < cuts.length; segment += 1) {
    const start = cuts[segment] ?? 0;
    const end = cuts[segment + 1] ?? 0;
    if (end <= start) continue;
    const codePoints = Array.from(sequence.codePoints.subarray(start, end));
    const kind: ShardKind = start < sequence.rankedCount ? 'ranked' : 'tail';
    described.push(describeShard(codePoints, kind, usage, costs));
  }
  return { shards: assignKeys(described) };
}

/** 按某个字体的体积模型估算一片；同一分组的各款式共用切分、各自估算体积。 */
export function estimateShardBytes(
  codePoints: CodePointList,
  kind: ShardKind,
  usage: UsageModel,
  costs: CostModel,
): number {
  return describeShard(Array.from(codePoints), kind, usage, costs).estimatedBytes;
}

/** 同一批字符打成单个文件的估算体积，作为"相比单文件"的比较基准。 */
export function estimateSingleFileBytes(
  available: CodePointList,
  usage: UsageModel,
  costs: CostModel,
): number {
  return available.length === 0 ? 0 : estimateShardBytes(available, 'single', usage, costs);
}
