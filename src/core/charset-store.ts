import { expandRanges, type CodePointRange } from './range-codec';

export type CharsetCategory = 'simplified' | 'traditional' | 'unicode' | 'functional';

export interface CharsetSummary {
  readonly id: string;
  readonly name: string;
  readonly category: CharsetCategory;
  readonly expectedCount: number;
  readonly officialEntryCount?: number;
  readonly standard: string;
  readonly description: string;
}

export interface CharsetIndex {
  readonly version: number;
  readonly presets: readonly CharsetSummary[];
}

export interface CharsetPreset extends CharsetSummary {
  readonly source: string;
  readonly sourceRevision?: string;
  readonly license: string;
  readonly ranges: readonly CodePointRange[];
  /** 展开后的升序码点。 */
  readonly codePoints: readonly number[];
}

export function isExternalHttpUrl(value: string): boolean {
  return /^https?:\/\/[^\s\\]+$/iu.test(value) && !/[\u0000-\u001F\u007F]/u.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCategory(value: unknown): value is CharsetCategory {
  return ['simplified', 'traditional', 'unicode', 'functional'].includes(String(value));
}

function parseSummary(value: unknown): CharsetSummary {
  if (!isRecord(value)) throw new Error('字符集索引项不是对象');
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isCategory(value.category) ||
    !Number.isInteger(value.expectedCount) ||
    typeof value.standard !== 'string' ||
    typeof value.description !== 'string'
  ) {
    throw new Error('字符集索引项字段无效');
  }
  return {
    id: value.id,
    name: value.name,
    category: value.category,
    expectedCount: value.expectedCount as number,
    ...(Number.isInteger(value.officialEntryCount)
      ? { officialEntryCount: value.officialEntryCount as number }
      : {}),
    standard: value.standard,
    description: value.description,
  };
}

export function parseCharsetIndex(value: unknown): CharsetIndex {
  if (!isRecord(value) || !Number.isInteger(value.version) || !Array.isArray(value.presets)) {
    throw new Error('字符集 index.json 格式无效');
  }
  return { version: value.version as number, presets: value.presets.map(parseSummary) };
}

export function parseCharsetPreset(value: unknown): CharsetPreset {
  const summary = parseSummary(value);
  if (!isRecord(value) || typeof value.source !== 'string' || typeof value.license !== 'string') {
    throw new Error(`${summary.id} 缺少来源或许可字段`);
  }
  if (!isExternalHttpUrl(value.source)) {
    throw new Error(`${summary.id} 的来源必须是绝对 HTTP(S) URL`);
  }
  if (!Array.isArray(value.ranges)) throw new Error(`${summary.id} 缺少 ranges`);
  const ranges: CodePointRange[] = value.ranges.map((range: unknown) => {
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !Number.isInteger(range[0]) ||
      !Number.isInteger(range[1])
    ) {
      throw new Error(`${summary.id} 包含无效区间`);
    }
    return [range[0] as number, range[1] as number] as const;
  });
  // expandRanges 同时执行严格的升序、不重叠与标量值校验。
  const codePoints = expandRanges(ranges);
  if (codePoints.length !== summary.expectedCount) {
    throw new Error(`${summary.id} 展开数 ${String(codePoints.length)} 与索引不一致`);
  }
  return {
    ...summary,
    source: value.source,
    ...(typeof value.sourceRevision === 'string' ? { sourceRevision: value.sourceRevision } : {}),
    license: value.license,
    ranges,
    codePoints,
  };
}
