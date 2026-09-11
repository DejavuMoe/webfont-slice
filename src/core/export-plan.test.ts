import { describe, expect, it } from 'vitest';
import {
  availableFor,
  createCostModel,
  createExportPlan,
  defaultFaceDraft,
  shardFileName,
  type FaceDraft,
  type FaceSource,
  type OutputSettings,
} from './export-plan';
import { WESTERN_LEVEL_RANGES } from './font-script';
import { createUsageModel, EMPTY_FREQUENCY } from './frequency';
import type { CodePointRange } from './range-codec';
import { DEFAULT_PLAN_SETTINGS } from './shard-planner';
import { fakeInspection, WGHT_AXIS, weightInstances } from './test-support';

const OUTPUT: OutputSettings = {
  urlPrefix: '',
  fontDisplay: 'swap',
  keepHinting: false,
  cjkFeatures: true,
  trimMetadata: true,
};

const han = Array.from({ length: 800 }, (_, index) => 0x4e00 + index);
const coverage = [0x41, 0x42, 0x43, ...han];
const usage = createUsageModel(EMPTY_FREQUENCY, 'hans');

function face(id: string, patch: Parameters<typeof fakeInspection>[0]): FaceSource {
  return { id, inspection: fakeInspection(patch) };
}

function plan(
  faces: readonly FaceSource[],
  options: {
    readonly requested?: readonly number[];
    readonly all?: boolean;
    readonly fontRanges?: readonly CodePointRange[];
    readonly drafts?: ReadonlyMap<string, FaceDraft>;
    readonly output?: Partial<OutputSettings>;
  } = {},
) {
  return createExportPlan({
    faces,
    drafts: options.drafts ?? new Map(),
    target: {
      requested: options.requested ?? [0x41, 0x42, ...han.slice(0, 500), 0x9fa5],
      allFontCharacters: options.all ?? false,
      ...(options.fontRanges === undefined ? {} : { fontRanges: options.fontRanges }),
    },
    usage,
    planSettings: DEFAULT_PLAN_SETTINGS,
    output: { ...OUTPUT, ...options.output },
  });
}

describe('导出规划', () => {
  it('逐字体求可用与缺字，并给出估算体积', () => {
    const result = plan([face('a', { coverage })]);
    expect(result.issues).toEqual([]);
    const [output] = result.outputs;
    expect(output?.available).toHaveLength(502);
    expect(output?.missing).toEqual([0x9fa5]);
    expect(output?.shards.length).toBeGreaterThan(1);
    expect(result.totalEstimatedBytes).toBeGreaterThan(0);
    expect(result.primaryOutputId).toBe(output?.id);
    expect(output?.filePrefix).toBe('demo-sans');
  });

  it('同字族多字重共享同一切分', () => {
    const regular = face('r', { coverage });
    const bold = face('b', { coverage, weight: 700, subfamily: 'Bold', fileName: 'Demo-Bold.ttf' });
    const result = plan([regular, bold]);
    expect(result.issues).toEqual([]);
    const [first, second] = result.outputs;
    expect(first?.shards.map((shard) => shard.codePoints)).toEqual(
      second?.shards.map((shard) => shard.codePoints),
    );
    expect(result.totalShardCount).toBe((first?.shards.length ?? 0) * 2);
  });

  it('检测重复的字体坐标与空字族名', () => {
    const result = plan([face('a', { coverage }), face('b', { coverage, fileName: 'Copy.ttf' })]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'duplicate-face' }));
    const drafts = new Map([
      ['a', { ...defaultFaceDraft(fakeInspection({ coverage })), family: '  ' }],
    ]);
    expect(plan([face('a', { coverage })], { drafts }).issues).toContainEqual({
      code: 'family-empty',
      fileName: 'Demo-Regular.ttf',
    });
  });

  it('自定义文件名前缀进入分片文件名，非法前缀被报告', () => {
    const inspection = fakeInspection({ coverage });
    const custom = plan([face('a', { coverage })], {
      drafts: new Map([['a', { ...defaultFaceDraft(inspection), filePrefix: 'lxgw' }]]),
    });
    const [output] = custom.outputs;
    expect(output?.filePrefix).toBe('lxgw');
    expect(output === undefined ? '' : shardFileName(output, '87', 'f73f604a')).toBe(
      'lxgw-400-87.f73f604a.woff2',
    );
    const invalid = plan([face('a', { coverage })], {
      drafts: new Map([['a', { ...defaultFaceDraft(inspection), filePrefix: '霞鹜' }]]),
    });
    expect(invalid.issues).toContainEqual({ code: 'prefix-invalid', fileName: 'Demo-Regular.ttf' });
  });

  it('不含任何目标字符的字体被明确报告', () => {
    const result = plan([face('a', { coverage: [0x41] })], { requested: [0x4e00] });
    expect(result.issues).toContainEqual({ code: 'face-empty', fileName: 'Demo-Regular.ttf' });
  });

  it('没有目标字符与路径无效时阻止导出', () => {
    expect(plan([face('a', { coverage })], { requested: [] }).issues).toContainEqual({
      code: 'no-characters',
    });
    const url = plan([face('a', { coverage })], { output: { urlPrefix: 'javascript:x' } });
    expect(url.issues.some((issue) => issue.code === 'url-invalid')).toBe(true);
  });

  it('不同字重的款式文件名互不冲突', () => {
    const regular = face('r', { coverage });
    const bold = face('b', { coverage, weight: 700, fileName: 'Bold.ttf' });
    const result = plan([regular, bold]);
    expect(result.issues.some((issue) => issue.code === 'duplicate-file')).toBe(false);
    const names = result.outputs.map((output) => shardFileName(output, '01'));
    expect(names).toEqual(['demo-sans-400-01.woff2', 'demo-sans-700-01.woff2']);
  });

  it('字体全部字符模式以 cmap 为准', () => {
    const result = plan([face('a', { coverage })], { requested: [0x9fa5], all: true });
    expect(result.outputs[0]?.available).toHaveLength(coverage.length);
    expect(result.outputs[0]?.missing).toEqual([0x9fa5]);
  });

  it('按区块取字体自身字符：字体没有的不算缺字，自定义字符照常补入与报告', () => {
    const western = [
      ...Array.from({ length: 95 }, (_, index) => 0x20 + index),
      0xe9,
      0x3b1,
      0x2500,
    ];
    const target = {
      requested: [0x3b1, 0x5b57],
      allFontCharacters: false,
      fontRanges: WESTERN_LEVEL_RANGES.common,
    };
    expect(availableFor(target, western)).toEqual([
      ...Array.from({ length: 95 }, (_, index) => 0x20 + index),
      0xe9,
      0x3b1,
    ]);
    const result = plan([face('m', { coverage: western })], {
      requested: [],
      fontRanges: WESTERN_LEVEL_RANGES.full,
    });
    expect(result.issues).toEqual([]);
    expect(result.outputs[0]?.available).toEqual(
      western.filter((codePoint) => codePoint !== 0x2500),
    );
    expect(result.outputs[0]?.missing).toEqual([]);
    expect(result.outputs[0]?.monospace).toBe(false);
  });

  it('可变字体：保留轴输出字重范围，固定款式输出多个静态款式', () => {
    const variable = face('v', {
      coverage,
      variable: true,
      variationAxes: [WGHT_AXIS],
      variationInstances: weightInstances(),
      glyphCosts: {
        outlineBytes: coverage.map(() => 300),
        variationBytes: coverage.map(() => 200),
        ratio: 0.5,
        overhead: 1000,
        calibrated: true,
      },
    });
    const preserved = plan([variable]);
    expect(preserved.outputs[0]?.weight).toEqual([100, 900]);
    expect(preserved.outputs[0]?.variationMode).toBe('preserve');

    const drafts = new Map([
      [
        'v',
        {
          ...defaultFaceDraft(variable.inspection),
          variationMode: 'static' as const,
          instanceIds: ['wght-400', 'wght-700'],
        },
      ],
    ]);
    const pinned = plan([variable], { drafts });
    expect(pinned.issues).toEqual([]);
    expect(pinned.outputs.map((output) => output.weight)).toEqual([400, 700]);
    expect(pinned.outputs[0]?.variationCoordinates).toEqual({ wght: 400 });
    expect(pinned.totalEstimatedBytes).toBeLessThan(preserved.totalEstimatedBytes * 2);

    const empty = new Map([
      [
        'v',
        {
          ...defaultFaceDraft(variable.inspection),
          variationMode: 'static' as const,
          instanceIds: [],
        },
      ],
    ]);
    expect(plan([variable], { drafts: empty }).issues).toContainEqual({
      code: 'instances-empty',
      fileName: 'Demo-Regular.ttf',
    });
  });

  it('排除的字体不进入输出；全部排除时报错', () => {
    const drafts = new Map([
      ['a', { ...defaultFaceDraft(fakeInspection({ coverage })), included: false }],
    ]);
    expect(plan([face('a', { coverage })], { drafts }).issues).toContainEqual({ code: 'no-faces' });
  });

  it('成本模型对未知码点使用平均值，静态实例不计变体数据', () => {
    const inspection = fakeInspection({
      coverage: [0x4e00, 0x4e01],
      glyphCosts: {
        outlineBytes: [100, 300],
        variationBytes: [100, 100],
        ratio: 0.5,
        overhead: 900,
        calibrated: true,
      },
    });
    expect(createCostModel(inspection, true).cost(0x4e00)).toBe(100);
    expect(createCostModel(inspection, false).cost(0x4e00)).toBe(50);
    expect(createCostModel(inspection, false).cost(0x9999)).toBe(100);
    expect(createCostModel(inspection, true).overhead).toBe(900);
  });

  it('分片文件名包含款式与序号', () => {
    const result = plan([face('a', { coverage })]);
    const output = result.outputs[0];
    if (output === undefined) throw new Error('missing output');
    expect(shardFileName(output, '03')).toBe('demo-sans-400-03.woff2');
    expect(shardFileName(output, '03', 'deadbeef')).toBe('demo-sans-400-03.deadbeef.woff2');
  });
});
