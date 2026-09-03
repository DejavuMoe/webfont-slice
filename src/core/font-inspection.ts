import type { FontStyle } from './css-gen';
import type { FontFormat } from './font-format';
import type { UnicodeBlockCoverage } from './unicode-coverage';
import type { VariationAxis, VariationInstance } from './variation';

/**
 * 字形体积估算。
 *
 * `outlineBytes[i]` 为 `coverage[i]` 对应字形在 glyf/CFF/CFF2 中的原始字节，
 * `variationBytes[i]` 为其 gvar 变体数据（仅可变 TrueType）。压缩后字节 ≈
 * `overhead + ratio · Σ raw`，两个系数由对该字体的实测子集化校准
 * （`calibrated=false` 时为经验值）。
 *
 * 另有两个实测修正：按码点连续取字时相邻字形部件相似，WOFF2 压缩得更好
 * （`runScale` < 1）；基础片的拉丁字母与标点带有字距等布局数据，
 * 按字形估算会偏小（`baseScale` > 1）。
 */
export interface GlyphCostTable {
  readonly outlineBytes: readonly number[];
  readonly variationBytes?: readonly number[];
  readonly ratio: number;
  readonly overhead: number;
  readonly calibrated: boolean;
  readonly runScale?: number;
  /** 西文字体按文字分组（`scriptFamily`）实测的连续码点系数，未测的组用 `runScale`。 */
  readonly familyRunScales?: Readonly<Record<string, number>>;
  readonly baseScale?: number;
}

/** 可序列化的字体分析快照，不携带任何平台对象或运行时句柄。 */
export interface FontInspection {
  readonly fileName: string;
  readonly format: FontFormat;
  readonly sourceSize: number;
  readonly normalizedSize: number;
  readonly family: string;
  readonly subfamily: string;
  readonly fullName: string;
  readonly postScriptName: string;
  readonly version: string;
  readonly copyright: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly designer: string;
  readonly manufacturer: string;
  readonly weight: number;
  readonly style: FontStyle;
  /** ASCII 字母数字等宽（或缺少足够字母时按 post.isFixedPitch）。 */
  readonly monospace: boolean;
  readonly glyphCount: number;
  /** 升序码点。 */
  readonly coverage: readonly number[];
  readonly blockCoverage: readonly UnicodeBlockCoverage[];
  readonly unicodeBlocksVersion: string;
  readonly glyphCosts: GlyphCostTable;
  readonly variable: boolean;
  readonly variationAxes: readonly VariationAxis[];
  readonly variationInstances: readonly VariationInstance[];
  readonly colorTables: readonly string[];
  readonly layoutFeatures: readonly string[];
  readonly warnings: readonly InspectionWarning[];
}

export type InspectionWarning =
  | { readonly code: 'woff1-normalized' }
  | { readonly code: 'large-font'; readonly normalizedSize: number }
  | { readonly code: 'color-font'; readonly tables: readonly string[] }
  | { readonly code: 'calibration-failed' };
