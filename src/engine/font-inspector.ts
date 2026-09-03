import { parse, type Font } from 'opentype.js';
import type { FontStyle } from '../core/css-gen';
import type { FontFormat } from '../core/font-format';
import type { FontInspection, InspectionWarning } from '../core/font-inspection';
import { isUnicodeScalarValue } from '../core/range-codec';
import { calculateUnicodeBlockCoverage, UNICODE_BLOCKS_VERSION } from '../core/unicode-coverage';
import {
  defaultVariationCoordinates,
  isDefaultVariationCoordinates,
  variationInstanceId,
  type VariationAxis,
  type VariationInstance,
} from '../core/variation';
import {
  readAdvanceWidths,
  readGlyphSizes,
  readLayoutFeatures,
  readTableDirectory,
  type GlyphSizes,
} from './sfnt';

interface RuntimeCmap {
  readonly glyphIndexMap?: Readonly<Record<string, unknown>>;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function localizedName(value: unknown): string | undefined {
  const names = record(value);
  if (names === undefined) return undefined;
  for (const language of ['en', 'zh-CN', 'zh']) {
    const candidate = names[language];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return Object.values(names).find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  );
}

function fontName(namesValue: unknown, nameId: string, fallback = ''): string {
  const names = record(namesValue);
  if (names === undefined) return fallback;
  const direct = localizedName(names[nameId]);
  if (direct !== undefined) return direct;
  for (const platformNames of Object.values(names)) {
    const candidate = localizedName(record(platformNames)?.[nameId]);
    if (candidate !== undefined) return candidate;
  }
  return fallback;
}

function tableRecord(font: Font, name: string): Readonly<Record<string, unknown>> | undefined {
  const table: unknown = font.tables[name];
  return record(table);
}

function numericTableValue(font: Font, table: string, property: string, fallback: number): number {
  const value = tableRecord(font, table)?.[property];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function inferFontStyle(font: Font, subfamily: string): FontStyle {
  if (/oblique|slanted/iu.test(subfamily)) return 'oblique';
  const selection = numericTableValue(font, 'os2', 'fsSelection', 0);
  const italicAngle = numericTableValue(font, 'post', 'italicAngle', 0);
  return (selection & 1) === 1 || italicAngle !== 0 || /italic/iu.test(subfamily)
    ? 'italic'
    : 'normal';
}

function collectVariationAxes(font: Font): VariationAxis[] {
  const axes = tableRecord(font, 'fvar')?.axes;
  if (!Array.isArray(axes)) return [];
  return axes.flatMap((value): VariationAxis[] => {
    const axis = record(value);
    const tag = axis?.tag;
    const minValue = axis?.minValue;
    const defaultValue = axis?.defaultValue;
    const maxValue = axis?.maxValue;
    if (
      typeof tag !== 'string' ||
      !/^[\x20-\x7E]{4}$/u.test(tag) ||
      typeof minValue !== 'number' ||
      typeof defaultValue !== 'number' ||
      typeof maxValue !== 'number' ||
      !Number.isFinite(minValue + defaultValue + maxValue) ||
      minValue > defaultValue ||
      defaultValue > maxValue
    ) {
      return [];
    }
    return [{ tag, name: localizedName(axis?.name) ?? tag, minValue, defaultValue, maxValue }];
  });
}

function collectVariationInstances(
  font: Font,
  axes: readonly VariationAxis[],
  defaultName: string,
): VariationInstance[] {
  if (axes.length === 0) return [];
  const rawInstances = tableRecord(font, 'fvar')?.instances;
  const instances: VariationInstance[] = [];
  const ids = new Set<string>();
  if (Array.isArray(rawInstances)) {
    for (const value of rawInstances) {
      const raw = record(value);
      const rawCoordinates = record(raw?.coordinates);
      if (raw === undefined || rawCoordinates === undefined) continue;
      const coordinates: Record<string, number> = {};
      let valid = true;
      for (const axis of axes) {
        const coordinate = rawCoordinates[axis.tag] ?? axis.defaultValue;
        if (
          typeof coordinate !== 'number' ||
          !Number.isFinite(coordinate) ||
          coordinate < axis.minValue ||
          coordinate > axis.maxValue
        ) {
          valid = false;
          break;
        }
        coordinates[axis.tag] = coordinate;
      }
      if (!valid) continue;
      const id = variationInstanceId(axes, coordinates);
      if (ids.has(id)) continue;
      ids.add(id);
      const isDefault = isDefaultVariationCoordinates(axes, coordinates);
      instances.push({
        id,
        name: localizedName(raw.name) ?? (isDefault ? defaultName : id),
        postScriptName: localizedName(raw.postScriptName) ?? '',
        coordinates,
        isDefault,
      });
    }
  }
  if (!instances.some((instance) => instance.isDefault)) {
    const coordinates = defaultVariationCoordinates(axes);
    instances.unshift({
      id: variationInstanceId(axes, coordinates),
      name: defaultName,
      postScriptName: '',
      coordinates,
      isDefault: true,
    });
  }
  return instances;
}

/** 码点 → glyph id；排除映射到 .notdef 的条目。 */
function collectCmap(font: Font): { coverage: number[]; glyphIds: number[] } {
  const glyphIndexMap = (font.encoding as unknown as { cmap?: RuntimeCmap }).cmap?.glyphIndexMap;
  const pairs: [number, number][] = [];
  if (glyphIndexMap !== undefined) {
    for (const [key, value] of Object.entries(glyphIndexMap)) {
      const codePoint = Number(key);
      if (typeof value === 'number' && value > 0 && isUnicodeScalarValue(codePoint)) {
        pairs.push([codePoint, value]);
      }
    }
  } else {
    for (let index = 1; index < font.glyphs.length; index += 1) {
      for (const codePoint of font.glyphs.get(index).unicodes) pairs.push([codePoint, index]);
    }
  }
  pairs.sort((left, right) => left[0] - right[0]);
  const coverage: number[] = [];
  const glyphIds: number[] = [];
  for (const [codePoint, glyphId] of pairs) {
    if (coverage.at(-1) === codePoint) continue;
    coverage.push(codePoint);
    glyphIds.push(glyphId);
  }
  return { coverage, glyphIds };
}

/** ASCII 字母与数字。 */
function isAlphanumeric(codePoint: number): boolean {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
}

/**
 * 等宽判断以实际步进为准：ASCII 字母数字齐全时看它们是否同宽（很多中文等宽字体
 * 的 post.isFixedPitch 为 0，也有比例字体误设为 1）；字母不全时才相信 post 表。
 */
function detectMonospace(
  font: Font,
  data: ArrayBuffer,
  coverage: readonly number[],
  glyphIds: readonly number[],
): boolean {
  const ascii: number[] = [];
  coverage.forEach((codePoint, index) => {
    if (isAlphanumeric(codePoint)) ascii.push(glyphIds[index] ?? 0);
  });
  if (ascii.length >= 62) {
    const widths = readAdvanceWidths(data, ascii);
    if (widths !== null) return widths.every((width) => width > 0 && width === widths[0]);
  }
  return numericTableValue(font, 'post', 'isFixedPitch', 0) !== 0;
}

const DEFAULT_RATIO: Readonly<Record<GlyphSizes['flavor'], number>> = {
  glyf: 0.42,
  cff: 0.62,
  cff2: 0.58,
  unknown: 0.5,
};

export interface InspectFontInput {
  readonly fileName: string;
  readonly format: FontFormat;
  readonly sourceSize: number;
  readonly normalizedData: ArrayBuffer;
  readonly warnings?: readonly InspectionWarning[];
}

export interface InspectFontOutput {
  readonly inspection: FontInspection;
}

export function inspectFont(input: InspectFontInput): InspectFontOutput {
  const data = input.normalizedData;
  const font = parse(data, { lowMemory: true });
  const { coverage, glyphIds } = collectCmap(font);
  const tables = readTableDirectory(data);
  const tags = new Set([...tables.keys()].map((tag) => tag.trim().toLowerCase()));
  const colorTables = ['colr', 'cbdt', 'sbix', 'svg'].filter((tag) => tags.has(tag));
  const names: unknown = font.names;
  const family =
    fontName(names, 'preferredFamily', '') || fontName(names, 'fontFamily', 'Untitled');
  const subfamily =
    fontName(names, 'preferredSubfamily', '') || fontName(names, 'fontSubfamily', 'Regular');
  const variationAxes = collectVariationAxes(font);
  const sizes = readGlyphSizes(data);

  const outlineBytes = glyphIds.map((glyphId) => sizes.outline[glyphId] ?? 0);
  const variationBytes =
    sizes.variation === null
      ? undefined
      : glyphIds.map((glyphId) => sizes.variation?.[glyphId] ?? 0);

  const warnings: InspectionWarning[] = [...(input.warnings ?? [])];
  if (colorTables.length > 0) warnings.push({ code: 'color-font', tables: colorTables });

  return {
    inspection: {
      fileName: input.fileName,
      format: input.format,
      sourceSize: input.sourceSize,
      normalizedSize: data.byteLength,
      family,
      subfamily,
      fullName: fontName(names, 'fullName', `${family} ${subfamily}`),
      postScriptName: fontName(names, 'postScriptName'),
      version: fontName(names, 'version'),
      copyright: fontName(names, 'copyright'),
      license: fontName(names, 'license'),
      licenseUrl: fontName(names, 'licenseURL'),
      designer: fontName(names, 'designer'),
      manufacturer: fontName(names, 'manufacturer'),
      weight: numericTableValue(font, 'os2', 'usWeightClass', 400),
      style: inferFontStyle(font, subfamily),
      monospace: detectMonospace(font, data, coverage, glyphIds),
      glyphCount: font.numGlyphs,
      coverage,
      blockCoverage: calculateUnicodeBlockCoverage(coverage).filter((block) => block.covered > 0),
      unicodeBlocksVersion: UNICODE_BLOCKS_VERSION,
      glyphCosts: {
        outlineBytes,
        ...(variationBytes === undefined ? {} : { variationBytes }),
        ratio: DEFAULT_RATIO[sizes.flavor],
        overhead: 2400,
        calibrated: false,
      },
      variable: tags.has('fvar'),
      variationAxes,
      variationInstances: collectVariationInstances(font, variationAxes, subfamily),
      colorTables,
      layoutFeatures: readLayoutFeatures(data),
      warnings,
    },
  };
}
