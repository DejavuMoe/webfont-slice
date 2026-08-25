import type { FontInspection } from './font-inspection';
import type { VariationAxis, VariationInstance } from './variation';

/** 构造测试用的字体分析快照；coverage 需升序。 */
export function fakeInspection(
  patch: Partial<FontInspection> & { readonly coverage: readonly number[] },
): FontInspection {
  const coverage = patch.coverage;
  return {
    fileName: 'Demo-Regular.ttf',
    format: 'ttf',
    sourceSize: 8 * 1024 * 1024,
    normalizedSize: 8 * 1024 * 1024,
    family: 'Demo Sans',
    subfamily: 'Regular',
    fullName: 'Demo Sans Regular',
    postScriptName: 'DemoSans-Regular',
    version: 'Version 1.000',
    copyright: '',
    license: 'SIL Open Font License 1.1',
    licenseUrl: 'https://openfontlicense.org',
    designer: '',
    manufacturer: '',
    weight: 400,
    style: 'normal',
    monospace: false,
    glyphCount: coverage.length + 1,
    blockCoverage: [],
    unicodeBlocksVersion: '17.0.0',
    glyphCosts: {
      outlineBytes: coverage.map((codePoint) => (codePoint < 0x3000 ? 120 : 400)),
      ratio: 0.5,
      overhead: 1200,
      calibrated: true,
    },
    variable: false,
    variationAxes: [],
    variationInstances: [],
    colorTables: [],
    layoutFeatures: ['kern', 'palt'],
    warnings: [],
    ...patch,
  };
}

export const WGHT_AXIS: VariationAxis = {
  tag: 'wght',
  name: 'Weight',
  minValue: 100,
  defaultValue: 400,
  maxValue: 900,
};

export function weightInstances(): VariationInstance[] {
  return [100, 400, 700, 900].map((weight) => ({
    id: `wght-${String(weight)}`,
    name: weight === 400 ? 'Regular' : weight === 700 ? 'Bold' : String(weight),
    postScriptName: '',
    coordinates: { wght: weight },
    isDefault: weight === 400,
  }));
}
