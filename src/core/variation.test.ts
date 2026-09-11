import { describe, expect, it } from 'vitest';
import {
  defaultVariationCoordinates,
  isDefaultVariationCoordinates,
  selectableVariationInstances,
  validatePinnedVariationCoordinates,
  variationInstanceId,
  variationStretch,
  variationStyle,
  variationWeight,
  type VariationAxis,
  type VariationInstance,
} from './variation';

const axes: readonly VariationAxis[] = [
  { tag: 'wght', name: 'Weight', minValue: 200, defaultValue: 400, maxValue: 900 },
  { tag: 'opsz', name: 'Optical Size', minValue: 8, defaultValue: 20, maxValue: 60 },
];

function instance(name: string, wght: number, opsz: number): VariationInstance {
  const coordinates = { wght, opsz };
  return {
    id: variationInstanceId(axes, coordinates),
    name,
    postScriptName: '',
    coordinates,
    isDefault: wght === 400 && opsz === 20,
  };
}

describe('可变字体领域规则', () => {
  it('生成稳定坐标 ID 并识别缺省坐标', () => {
    const coordinates = defaultVariationCoordinates(axes);
    expect(coordinates).toEqual({ wght: 400, opsz: 20 });
    expect(variationInstanceId(axes, coordinates)).toBe('wght-400_opsz-20');
    expect(isDefaultVariationCoordinates(axes, coordinates)).toBe(true);
  });

  it('普通界面只保留非 CSS 轴处于默认值的款式', () => {
    const values = [
      instance('Caption', 400, 8),
      instance('Regular', 400, 20),
      instance('Bold', 700, 20),
      instance('Display Bold', 700, 60),
    ];
    expect(selectableVariationInstances(axes, values).map((value) => value.name)).toEqual([
      'Regular',
      'Bold',
    ]);
  });

  it('固定款式要求完整且位于范围内的轴坐标', () => {
    expect(validatePinnedVariationCoordinates(axes, { wght: 400, opsz: 20 })).toEqual([]);
    expect(validatePinnedVariationCoordinates(axes, { wght: 1000 })).toEqual([
      '变体轴 wght 必须在 200–900 之间',
      '固定款式缺少变体轴 opsz',
    ]);
    expect(validatePinnedVariationCoordinates(axes, { wght: 400, opsz: 20, TEST: 1 })).toEqual([
      '字体不包含变体轴 TEST',
    ]);
  });

  it('从标准轴推断静态 CSS 坐标', () => {
    const styleAxes: VariationAxis[] = [
      ...axes,
      { tag: 'wdth', name: 'Width', minValue: 75, defaultValue: 100, maxValue: 125 },
      { tag: 'ital', name: 'Italic', minValue: 0, defaultValue: 0, maxValue: 1 },
    ];
    const coordinates = { wght: 700, opsz: 20, wdth: 90, ital: 1 };
    expect(variationWeight(styleAxes, coordinates, 400)).toBe(700);
    expect(variationStretch(styleAxes, coordinates)).toBe(90);
    expect(variationStyle(styleAxes, coordinates, 'normal')).toBe('italic');
  });
});
