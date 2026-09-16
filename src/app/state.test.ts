import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_SETTINGS } from '../core/shard-planner';
import type { CharsetPreset } from '../core/charset-store';
import { fakeInspection } from '../core/test-support';
import {
  selectCharacterTarget,
  selectExportPlan,
  selectFontScript,
  selectLanguageDetection,
  selectLevelEstimates,
  selectRecommendedLevel,
  selectRequiredPresetIds,
  selectTextProfile,
} from './derive';
import { initialState, parsePersistedSettings } from './state';
import { createStore, memoizeLast } from './store';

describe('偏好持久化', () => {
  it('严格校验读入值，异常字段回落默认', () => {
    const parsed = parsePersistedSettings({
      plan: { strategy: 'evil', granularity: 99 },
      output: { fontDisplay: 'nope', urlPrefix: '/fonts', keepHinting: true },
      characters: {
        language: 'hant-hk',
        level: 'nope',
        extras: ['kana', 'bad'],
        libraryIds: ['u-kana', '../x'],
      },
      pageProfile: 'longform',
    });
    expect(parsed.plan).toEqual({ ...DEFAULT_PLAN_SETTINGS, granularity: 7 });
    expect(parsed.output?.fontDisplay).toBe('swap');
    expect(parsed.output?.keepHinting).toBe(true);
    expect(parsed.output?.urlPrefix).toBe('/fonts');
    expect(parsed.characters?.language).toBe('hant-hk');
    expect(parsed.characters?.level).toBe('common');
    expect(parsed.characters?.extras).toEqual(['kana']);
    expect(parsed.characters?.libraryIds).toEqual(['u-kana']);
    expect(parsed.pageProfile).toBe('longform');
    expect(parsePersistedSettings('garbage')).toEqual({});
  });

  it('初始状态合并持久化偏好但不恢复正文', () => {
    const state = initialState({ plan: { ...DEFAULT_PLAN_SETTINGS, granularity: 2 } });
    expect(state.plan.granularity).toBe(2);
    expect(state.characters.customText).toBe('');
    expect(state.charactersTouched).toBe(false);
  });
});

describe('派生状态', () => {
  it('字表未加载时为 loading，自定义文本与区间立即生效，假名自动补入', () => {
    const base = initialState();
    const state = {
      ...base,
      characters: {
        ...base.characters,
        customText: '天地 玄黄 あ',
        customRanges: 'U+4E00-4E01, bad',
      },
    };
    const target = selectCharacterTarget(state);
    expect(target.status).toBe('loading');
    expect(target.customCodePoints).toEqual(
      [0x3042, 0x4e00, 0x4e01, 0x5929, 0x5730, 0x7384, 0x9ec4].sort((a, b) => a - b),
    );
    expect(target.impliedExtras).toEqual(['kana']);
    expect(target.presetIds).toContain('u-kana');
    expect(target.rangeErrors.map((error) => error.token)).toEqual(['bad']);
  });

  it('语言：显式设置优先，其次按字体覆盖判断，默认简体', () => {
    const base = initialState();
    expect(selectLanguageDetection(base)).toEqual({ language: 'hans', basis: 'default' });
    expect(selectTextProfile(base)).toBe('hans');
    const explicit = { ...base, characters: { ...base.characters, language: 'hant-tw' as const } };
    expect(selectLanguageDetection(explicit)).toEqual({ language: 'hant-tw', basis: 'setting' });
    expect(selectTextProfile(explicit)).toBe('hant');

    const han = Array.from({ length: 600 }, (_, index) => 0x4e00 + index);
    const preset = (id: string, codePoints: readonly number[]): CharsetPreset => ({
      id,
      name: id,
      category: 'traditional',
      expectedCount: codePoints.length,
      standard: 'test',
      description: 'test',
      source: 'https://example.com',
      license: 'test',
      ranges: [],
      codePoints,
    });
    const presets = new Map<string, CharsetPreset>([
      ['sc-tgh-1', preset('sc-tgh-1', han.slice(0, 300))],
      ['tc-moe-common', preset('tc-moe-common', han.slice(300, 600))],
      ['tc-hk-common', preset('tc-hk-common', han.slice(300, 600))],
    ]);
    const detected = {
      ...base,
      data: { ...base.data, presets },
      fonts: [
        {
          id: 'f',
          file: new File([], 'f.ttf'),
          status: 'ready' as const,
          inspection: fakeInspection({ coverage: han.slice(280, 600) }),
          error: null,
          draft: null,
        },
      ],
    };
    expect(selectLanguageDetection(detected)).toEqual({ language: 'hant-tw', basis: 'font' });
    expect(selectRecommendedLevel(detected)).toBe('common');
    expect(
      selectRecommendedLevel({
        ...detected,
        fonts: detected.fonts.map((font) => ({
          ...font,
          inspection: fakeInspection({ coverage: [0x41, 0x42] }),
        })),
      }),
    ).toBe('all');
  });
});

describe('西文字体', () => {
  const coverage = [
    ...Array.from({ length: 95 }, (_, index) => 0x20 + index),
    0xe9,
    0x3b1,
    0x430,
    0x2500,
    0xe0a0,
  ];
  const base = initialState();
  const state = {
    ...base,
    characters: { ...base.characters, level: 'common' as const, customText: 'λ 字' },
    fonts: [
      {
        id: 'm',
        file: new File([], 'mono.ttf'),
        status: 'ready' as const,
        inspection: fakeInspection({ coverage, monospace: true }),
        error: null,
        draft: null,
      },
    ],
  };

  it('按区块取字体字符，不加载汉字字表，只有自定义文本可能缺字', () => {
    expect(selectFontScript(state)).toBe('western');
    expect(selectRecommendedLevel(state)).toBe('all');
    const target = selectCharacterTarget(state);
    expect(target.status).toBe('ready');
    expect(target.presetIds).toEqual([]);
    expect(selectRequiredPresetIds(state)).toEqual([]);
    expect(target.rangeCodePoints).toEqual(coverage.slice(0, 96));
    const output = selectExportPlan(state)?.outputs[0];
    expect(output?.available).toEqual(coverage.slice(0, 96));
    expect(output?.missing).toEqual([0x3bb, 0x5b57]);
    expect(output?.monospace).toBe(true);
  });

  it('四档对比：全部包含图标与制表符，档位越高字数越多', () => {
    const estimates = selectLevelEstimates(state);
    const count = (level: string) => estimates.find((item) => item.level === level)?.characters;
    expect(count('common')).toBe(96);
    expect(count('full')).toBe(98);
    expect(count('all')).toBe(coverage.length);
  });
});

describe('store', () => {
  it('只在状态引用变化时通知订阅者', () => {
    const store = createStore({ value: 1 });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    store.set((state) => state);
    store.set((state) => ({ value: state.value + 1 }));
    unsubscribe();
    store.set((state) => ({ value: state.value + 1 }));
    expect(calls).toBe(1);
    expect(store.get().value).toBe(3);
  });

  it('单槽记忆化按参数引用命中', () => {
    let runs = 0;
    const square = memoizeLast((value: number) => {
      runs += 1;
      return value * value;
    });
    expect(square(3)).toBe(9);
    expect(square(3)).toBe(9);
    expect(square(4)).toBe(16);
    expect(runs).toBe(2);
  });
});
