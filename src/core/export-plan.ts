import {
  differenceSorted,
  hashHex,
  intersectSorted,
  unionSorted,
  type CodePointList,
} from './codepoints';
import {
  validateUrlPrefix,
  type CssFontDisplay,
  type FontNumericDescriptor,
  type FontStyle,
} from './css-gen';
import type { FontInspection } from './font-inspection';
import type { UsageModel } from './frequency';
import { fileNameFor, filePrefixFor, isValidFilePrefix } from './naming';
import { evaluateShards, type PlanMetrics } from './plan-metrics';
import { filterByRanges, type CodePointRange } from './range-codec';
import {
  estimateShardBytes,
  estimateSingleFileBytes,
  planShards,
  scriptFamily,
  type CostModel,
  type PlanSettings,
  type PlannedShard,
} from './shard-planner';
import {
  MAX_STATIC_VARIATION_INSTANCES,
  selectableVariationInstances,
  validatePinnedVariationCoordinates,
  variationStretch,
  variationStyle,
  variationWeight,
} from './variation';

export type VariationMode = 'preserve' | 'static';

/** 用户对单个源字体的输出覆盖。未填写的字段使用字体自身信息。 */
export interface FaceDraft {
  readonly included: boolean;
  readonly family: string;
  /** 分片文件名前缀；留空时由字族名生成。 */
  readonly filePrefix: string;
  readonly weight: number;
  readonly style: FontStyle;
  readonly variationMode: VariationMode;
  readonly instanceIds: readonly string[];
}

/**
 * 输出设置分两类：前两项只影响生成的 CSS 文本，可以在结果页即时修改；
 * 后三项影响分片字节，修改后需要重新生成。
 */
export interface OutputSettings {
  readonly urlPrefix: string;
  readonly fontDisplay: CssFontDisplay;
  readonly keepHinting: boolean;
  readonly cjkFeatures: boolean;
  readonly trimMetadata: boolean;
}

export type TextOutputSettings = Pick<OutputSettings, 'urlPrefix' | 'fontDisplay'>;

export interface FaceSource {
  readonly id: string;
  readonly inspection: FontInspection;
}

export interface CharacterTarget {
  /** 预设 ∪ 自定义（升序）。 */
  readonly requested: CodePointList;
  /** 额外保留每个字体自身 cmap 的全部字符。 */
  readonly allFontCharacters: boolean;
  /**
   * 额外保留每个字体自身落在这些区间内的字符（西文字体的"西欧""多语言"档）。
   * 与 `requested` 不同，字体没有的字符不算缺字。
   */
  readonly fontRanges?: readonly CodePointRange[];
}

/** 某个字体在目标下实际输出的字符：所需且字体有的，加上按字体自身覆盖保留的。 */
export function availableFor(target: CharacterTarget, coverage: CodePointList): number[] {
  const requested = intersectSorted(target.requested, coverage);
  if (target.allFontCharacters) return unionSorted([coverage, requested]);
  const ranges = target.fontRanges ?? [];
  return ranges.length === 0
    ? requested
    : unionSorted([filterByRanges(coverage, ranges), requested]);
}

export type OutputVariationMode = 'none' | 'preserve' | 'static';

export interface ExportOutput {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceFileName: string;
  readonly sourceSize: number;
  readonly variantId: string;
  readonly instanceName: string;
  readonly family: string;
  readonly filePrefix: string;
  readonly postScriptName: string;
  readonly weight: FontNumericDescriptor;
  readonly stretch?: FontNumericDescriptor;
  readonly style: FontStyle;
  readonly variationMode: OutputVariationMode;
  readonly variationCoordinates?: Readonly<Record<string, number>>;
  /** 源字体是等宽字体：用法示例与预览改为代码。 */
  readonly monospace: boolean;
  readonly available: CodePointList;
  readonly missing: CodePointList;
  readonly shards: readonly PlannedShard[];
  readonly metrics: PlanMetrics;
  /** 同一批字符打成单个文件的估算体积，用作比较基准。 */
  readonly singleFileBytes: number;
  readonly costs: CostModel;
}

export type PlanIssue =
  | { readonly code: 'no-characters' }
  | { readonly code: 'no-faces' }
  | { readonly code: 'face-empty'; readonly fileName: string }
  | { readonly code: 'family-empty'; readonly fileName: string }
  | { readonly code: 'prefix-invalid'; readonly fileName: string }
  | { readonly code: 'weight-invalid'; readonly fileName: string }
  | { readonly code: 'instances-empty'; readonly fileName: string }
  | { readonly code: 'instances-too-many'; readonly fileName: string; readonly max: number }
  | { readonly code: 'instance-invalid'; readonly fileName: string; readonly detail: string }
  | {
      readonly code: 'duplicate-face';
      readonly family: string;
      readonly weight: string;
      readonly style: FontStyle;
    }
  | { readonly code: 'duplicate-file'; readonly fileName: string }
  | { readonly code: 'url-invalid'; readonly message: string };

export interface ExportPlan {
  readonly outputs: readonly ExportOutput[];
  readonly issues: readonly PlanIssue[];
  readonly primaryOutputId: string | null;
  readonly totalEstimatedBytes: number;
  readonly totalShardCount: number;
  readonly totalSourceBytes: number;
  readonly urlPrefix: string;
}

export function defaultFaceDraft(inspection: FontInspection): FaceDraft {
  return {
    included: true,
    family: inspection.family,
    filePrefix: '',
    weight: inspection.weight,
    style: inspection.style,
    variationMode: 'preserve',
    instanceIds: [],
  };
}

const DEFAULT_OUTLINE_BYTES = 480;

/** 由体检得到的字形体积表构造该输出的压缩字节估算模型。 */
export function createCostModel(inspection: FontInspection, includeVariations: boolean): CostModel {
  const table = inspection.glyphCosts;
  const byCodePoint = new Map<number, number>();
  let sum = 0;
  inspection.coverage.forEach((codePoint, index) => {
    const outline = table.outlineBytes[index] ?? DEFAULT_OUTLINE_BYTES;
    const variation = includeVariations ? (table.variationBytes?.[index] ?? 0) : 0;
    const raw = outline + variation;
    byCodePoint.set(codePoint, raw);
    sum += raw;
  });
  const average = byCodePoint.size > 0 ? sum / byCodePoint.size : DEFAULT_OUTLINE_BYTES;
  const ratio = table.ratio > 0 ? table.ratio : 0.5;
  const families = table.familyRunScales;
  return {
    overhead: Math.max(256, table.overhead),
    cost: (codePoint) => ratio * (byCodePoint.get(codePoint) ?? average),
    ...(table.runScale === undefined ? {} : { runScale: table.runScale }),
    ...(families === undefined
      ? {}
      : { runScaleFor: (codePoint: number) => families[String(scriptFamily(codePoint))] }),
    ...(table.baseScale === undefined ? {} : { baseScale: table.baseScale }),
  };
}

function averageCostModel(models: readonly CostModel[]): CostModel {
  const [only] = models;
  if (models.length === 1 && only !== undefined) return only;
  const mean = (pick: (model: CostModel) => number) =>
    models.reduce((total, model) => total + pick(model), 0) / models.length;
  return {
    overhead: mean((model) => model.overhead),
    cost: (codePoint) => mean((model) => model.cost(codePoint)),
    runScale: mean((model) => model.runScale ?? 1),
    ...(models.some((model) => model.runScaleFor !== undefined)
      ? {
          runScaleFor: (codePoint: number) =>
            mean((model) => model.runScaleFor?.(codePoint) ?? model.runScale ?? 1),
        }
      : {}),
    baseScale: mean((model) => model.baseScale ?? 1),
  };
}

function descriptorKey(value: FontNumericDescriptor): string {
  return typeof value === 'number' ? String(value) : `${String(value[0])}-${String(value[1])}`;
}

function axisDescriptor(
  inspection: FontInspection,
  tag: string,
  fallback: number | undefined,
): FontNumericDescriptor | undefined {
  const axis = inspection.variationAxes.find((candidate) => candidate.tag === tag);
  if (axis === undefined) return fallback;
  return axis.minValue === axis.maxValue ? axis.minValue : [axis.minValue, axis.maxValue];
}

interface OutputDraft {
  readonly id: string;
  readonly source: FaceSource;
  readonly variantId: string;
  readonly instanceName: string;
  readonly postScriptName: string;
  readonly family: string;
  readonly filePrefix: string;
  readonly weight: FontNumericDescriptor;
  readonly stretch?: FontNumericDescriptor;
  readonly style: FontStyle;
  readonly variationMode: OutputVariationMode;
  readonly variationCoordinates?: Readonly<Record<string, number>>;
  readonly available: CodePointList;
  readonly missing: CodePointList;
  readonly costs: CostModel;
}

function outputsForFace(
  source: FaceSource,
  draft: FaceDraft,
  target: CharacterTarget,
  issues: PlanIssue[],
): OutputDraft[] {
  const inspection = source.inspection;
  const fileName = inspection.fileName;
  const family = draft.family.trim();
  if (family.length === 0) issues.push({ code: 'family-empty', fileName });
  const customPrefix = draft.filePrefix.trim();
  if (customPrefix.length > 0 && !isValidFilePrefix(customPrefix)) {
    issues.push({ code: 'prefix-invalid', fileName });
  }
  const filePrefix = filePrefixFor(customPrefix, family, inspection.postScriptName);
  if (!Number.isFinite(draft.weight) || draft.weight < 1 || draft.weight > 1000) {
    issues.push({ code: 'weight-invalid', fileName });
  }

  const available = availableFor(target, inspection.coverage);
  const missing = differenceSorted(target.requested, inspection.coverage);
  if (available.length === 0) {
    issues.push({ code: 'face-empty', fileName });
    return [];
  }

  const axes = inspection.variationAxes;
  if (axes.length === 0 || draft.variationMode === 'preserve') {
    const variable = axes.length > 0;
    const stretch = axisDescriptor(inspection, 'wdth', undefined);
    return [
      {
        id: `${source.id}:${variable ? 'variable' : 'static'}`,
        source,
        variantId: variable ? 'variable' : 'static',
        instanceName: variable ? 'Variable' : inspection.subfamily,
        postScriptName: inspection.postScriptName,
        family,
        filePrefix,
        weight: axisDescriptor(inspection, 'wght', draft.weight) ?? draft.weight,
        ...(stretch === undefined ? {} : { stretch }),
        style: draft.style,
        variationMode: variable ? 'preserve' : 'none',
        available,
        missing,
        costs: createCostModel(inspection, true),
      },
    ];
  }

  const selectable = new Map(
    selectableVariationInstances(axes, inspection.variationInstances).map((instance) => [
      instance.id,
      instance,
    ]),
  );
  const ids = [...new Set(draft.instanceIds)];
  if (ids.length === 0) {
    issues.push({ code: 'instances-empty', fileName });
    return [];
  }
  if (ids.length > MAX_STATIC_VARIATION_INSTANCES) {
    issues.push({ code: 'instances-too-many', fileName, max: MAX_STATIC_VARIATION_INSTANCES });
  }
  const costs = createCostModel(inspection, false);
  const outputs: OutputDraft[] = [];
  for (const id of ids) {
    const instance = selectable.get(id);
    if (instance === undefined) {
      issues.push({ code: 'instance-invalid', fileName, detail: id });
      continue;
    }
    for (const detail of validatePinnedVariationCoordinates(axes, instance.coordinates)) {
      issues.push({ code: 'instance-invalid', fileName, detail });
    }
    outputs.push({
      id: `${source.id}:${instance.id}`,
      source,
      variantId: instance.id,
      instanceName: instance.name,
      postScriptName: instance.postScriptName || inspection.postScriptName,
      family,
      filePrefix,
      weight: variationWeight(axes, instance.coordinates, draft.weight),
      stretch: variationStretch(axes, instance.coordinates),
      style: variationStyle(axes, instance.coordinates, draft.style),
      variationMode: 'static',
      variationCoordinates: { ...instance.coordinates },
      available,
      missing,
      costs,
    });
  }
  return outputs;
}

function primaryOutput(outputs: readonly ExportOutput[]): ExportOutput | null {
  let best: ExportOutput | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const output of outputs) {
    const weight = typeof output.weight === 'number' ? output.weight : 400;
    const score = Math.abs(weight - 400) + (output.style === 'normal' ? 0 : 1000);
    if (score < bestScore) {
      best = output;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 预检并规划导出。纯函数：同样的输入总得到同样的切分与文件名，
 * 因此界面可以实时预览、生成阶段可以按同一方案执行。
 */
export function createExportPlan(input: {
  readonly faces: readonly FaceSource[];
  readonly drafts: ReadonlyMap<string, FaceDraft>;
  readonly target: CharacterTarget;
  readonly usage: UsageModel;
  readonly planSettings: PlanSettings;
  readonly output: OutputSettings;
}): ExportPlan {
  const issues: PlanIssue[] = [];
  const { faces, drafts, target, usage, planSettings, output } = input;

  if (
    target.requested.length === 0 &&
    !target.allFontCharacters &&
    (target.fontRanges ?? []).length === 0
  ) {
    issues.push({ code: 'no-characters' });
  }

  let urlPrefix = '';
  try {
    urlPrefix = validateUrlPrefix(output.urlPrefix);
  } catch (error: unknown) {
    issues.push({ code: 'url-invalid', message: error instanceof Error ? error.message : '' });
  }

  const included = faces.filter(
    (face) => drafts.get(face.id)?.included ?? defaultFaceDraft(face.inspection).included,
  );
  if (included.length === 0) issues.push({ code: 'no-faces' });

  const drafted: OutputDraft[] = [];
  if (issues.every((issue) => issue.code !== 'no-characters')) {
    for (const face of included) {
      const draft = drafts.get(face.id) ?? defaultFaceDraft(face.inspection);
      drafted.push(...outputsForFace(face, draft, target, issues));
    }
  }

  const coordinates = new Set<string>();
  for (const candidate of drafted) {
    const key = [
      candidate.family.toLocaleLowerCase(),
      descriptorKey(candidate.weight),
      candidate.stretch === undefined ? '100' : descriptorKey(candidate.stretch),
      candidate.style,
    ].join('\u0000');
    if (coordinates.has(key)) {
      issues.push({
        code: 'duplicate-face',
        family: candidate.family,
        weight: descriptorKey(candidate.weight),
        style: candidate.style,
      });
    }
    coordinates.add(key);
  }

  // 可用字符集合相同的输出共用同一切分：同一字族不同字重的同号分片覆盖相同字符。
  const groups = new Map<string, OutputDraft[]>();
  for (const candidate of drafted) {
    const key = hashHex(candidate.available, 12);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [candidate]);
    else group.push(candidate);
  }

  const outputs: ExportOutput[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    const plan = planShards(
      first.available,
      usage,
      averageCostModel(group.map((candidate) => candidate.costs)),
      planSettings,
    );
    for (const candidate of group) {
      const shards = plan.shards.map((shard) => ({
        ...shard,
        estimatedBytes: estimateShardBytes(shard.codePoints, shard.kind, usage, candidate.costs),
      }));
      const inspection = candidate.source.inspection;
      outputs.push({
        id: candidate.id,
        sourceId: candidate.source.id,
        sourceFileName: inspection.fileName,
        sourceSize: inspection.sourceSize,
        variantId: candidate.variantId,
        instanceName: candidate.instanceName,
        family: candidate.family,
        filePrefix: candidate.filePrefix,
        postScriptName: candidate.postScriptName,
        weight: candidate.weight,
        ...(candidate.stretch === undefined ? {} : { stretch: candidate.stretch }),
        style: candidate.style,
        variationMode: candidate.variationMode,
        ...(candidate.variationCoordinates === undefined
          ? {}
          : { variationCoordinates: candidate.variationCoordinates }),
        monospace: inspection.monospace,
        available: candidate.available,
        missing: candidate.missing,
        shards,
        metrics: evaluateShards(
          shards.map((shard) => ({
            kind: shard.kind,
            mass: shard.mass,
            bytes: shard.estimatedBytes,
          })),
        ),
        singleFileBytes: estimateSingleFileBytes(candidate.available, usage, candidate.costs),
        costs: candidate.costs,
      });
    }
  }
  const order = new Map(drafted.map((candidate, index) => [candidate.id, index]));
  outputs.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));

  // 哈希在生成时才有；这里用相同占位符检查款式之间的文件名是否会撞车。
  const fileNames = new Set<string>();
  for (const candidate of outputs) {
    for (const shard of candidate.shards) {
      const fileName = shardFileName(candidate, shard.key);
      if (fileNames.has(fileName)) issues.push({ code: 'duplicate-file', fileName });
      fileNames.add(fileName);
    }
  }

  const sources = new Map(outputs.map((candidate) => [candidate.sourceId, candidate.sourceSize]));
  return {
    outputs,
    issues: dedupeIssues(issues),
    primaryOutputId: primaryOutput(outputs)?.id ?? null,
    totalEstimatedBytes: outputs.reduce(
      (total, candidate) => total + candidate.metrics.totalBytes,
      0,
    ),
    totalShardCount: outputs.reduce((total, candidate) => total + candidate.shards.length, 0),
    totalSourceBytes: [...sources.values()].reduce((total, size) => total + size, 0),
    urlPrefix,
  };
}

export function shardFileName(
  output: Pick<ExportOutput, 'filePrefix' | 'weight' | 'stretch' | 'style'>,
  shardKey: string,
  hash?: string,
): string {
  return fileNameFor(
    {
      prefix: output.filePrefix,
      weight: output.weight,
      ...(output.stretch === undefined ? {} : { stretch: output.stretch }),
      style: output.style,
      index: shardKey,
    },
    hash,
  );
}

function dedupeIssues(issues: readonly PlanIssue[]): PlanIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
