import type { FontStyle } from './css-gen';

export interface VariationAxis {
  readonly tag: string;
  readonly name: string;
  readonly minValue: number;
  readonly defaultValue: number;
  readonly maxValue: number;
}

export interface VariationInstance {
  readonly id: string;
  readonly name: string;
  readonly postScriptName: string;
  readonly coordinates: Readonly<Record<string, number>>;
  readonly isDefault: boolean;
}

export interface VariationAxisRange {
  readonly min?: number;
  readonly max?: number;
  readonly default?: number;
}

export type VariationAxisValue = number | VariationAxisRange;
export type VariationAxisSettings = Readonly<Record<string, VariationAxisValue>>;
export type VariationExportMode = 'preserve' | 'static';
export const MAX_STATIC_VARIATION_INSTANCES = 24;

export interface VariationExportSelection {
  readonly mode: VariationExportMode;
  readonly instanceIds: readonly string[];
}

const CSS_STYLE_AXES = new Set(['wght', 'wdth', 'ital']);
const COORDINATE_EPSILON = 1 / 65_536;

function coordinateValue(value: number): string {
  return String(Object.is(value, -0) ? 0 : Number(value.toFixed(6)));
}

export function variationInstanceId(
  axes: readonly VariationAxis[],
  coordinates: Readonly<Record<string, number>>,
): string {
  return axes
    .map((axis) => `${axis.tag}-${coordinateValue(coordinates[axis.tag] ?? axis.defaultValue)}`)
    .join('_');
}

export function defaultVariationCoordinates(
  axes: readonly VariationAxis[],
): Readonly<Record<string, number>> {
  return Object.fromEntries(axes.map((axis) => [axis.tag, axis.defaultValue]));
}

export function isDefaultVariationCoordinates(
  axes: readonly VariationAxis[],
  coordinates: Readonly<Record<string, number>>,
): boolean {
  return axes.every(
    (axis) =>
      Math.abs((coordinates[axis.tag] ?? axis.defaultValue) - axis.defaultValue) <=
      COORDINATE_EPSILON,
  );
}

/**
 * 普通 UI 只展示非 CSS 款式轴位于默认值的 named instances。
 * 例如 opsz×wght 字体只显示默认 opsz 下的常用字重，避免不可寻址的 CSS 冲突。
 */
export function selectableVariationInstances(
  axes: readonly VariationAxis[],
  instances: readonly VariationInstance[],
): VariationInstance[] {
  const selected = instances.filter((instance) =>
    axes.every(
      (axis) =>
        CSS_STYLE_AXES.has(axis.tag) ||
        Math.abs((instance.coordinates[axis.tag] ?? axis.defaultValue) - axis.defaultValue) <=
          COORDINATE_EPSILON,
    ),
  );
  const byStyleCoordinates = new Map<string, VariationInstance>();
  for (const instance of selected) {
    const key = axes
      .filter((axis) => CSS_STYLE_AXES.has(axis.tag))
      .map(
        (axis) =>
          `${axis.tag}:${coordinateValue(instance.coordinates[axis.tag] ?? axis.defaultValue)}`,
      )
      .join('|');
    if (!byStyleCoordinates.has(key) || instance.isDefault) byStyleCoordinates.set(key, instance);
  }
  const result = [...byStyleCoordinates.values()];
  if (result.length > 0) return result;
  const fallback = instances.find((instance) => instance.isDefault) ?? instances[0];
  return fallback === undefined ? [] : [fallback];
}

export function validatePinnedVariationCoordinates(
  axes: readonly VariationAxis[],
  coordinates: Readonly<Record<string, number>>,
): string[] {
  const issues: string[] = [];
  const axisByTag = new Map(axes.map((axis) => [axis.tag, axis]));
  for (const tag of Object.keys(coordinates)) {
    if (!axisByTag.has(tag)) issues.push(`字体不包含变体轴 ${tag}`);
  }
  for (const axis of axes) {
    const value = coordinates[axis.tag];
    if (value === undefined) {
      issues.push(`固定款式缺少变体轴 ${axis.tag}`);
    } else if (!Number.isFinite(value) || value < axis.minValue || value > axis.maxValue) {
      issues.push(
        `变体轴 ${axis.tag} 必须在 ${coordinateValue(axis.minValue)}–${coordinateValue(axis.maxValue)} 之间`,
      );
    }
  }
  return issues;
}

export function variationWeight(
  axes: readonly VariationAxis[],
  coordinates: Readonly<Record<string, number>>,
  fallback: number,
): number {
  const axis = axes.find((candidate) => candidate.tag === 'wght');
  return axis === undefined ? fallback : (coordinates.wght ?? axis.defaultValue);
}

export function variationStretch(
  axes: readonly VariationAxis[],
  coordinates: Readonly<Record<string, number>>,
): number {
  const axis = axes.find((candidate) => candidate.tag === 'wdth');
  return axis === undefined ? 100 : (coordinates.wdth ?? axis.defaultValue);
}

export function variationStyle(
  axes: readonly VariationAxis[],
  coordinates: Readonly<Record<string, number>>,
  fallback: FontStyle,
): FontStyle {
  const ital = axes.find((axis) => axis.tag === 'ital');
  if (ital !== undefined && (coordinates.ital ?? ital.defaultValue) >= 0.5) return 'italic';
  const slnt = axes.find((axis) => axis.tag === 'slnt');
  if (slnt !== undefined && Math.abs(coordinates.slnt ?? slnt.defaultValue) > COORDINATE_EPSILON) {
    return 'oblique';
  }
  return fallback;
}
