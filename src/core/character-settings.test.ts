import { describe, expect, it } from 'vitest';
import {
  BASE_PRESET_IDS,
  COVERAGE_LEVELS,
  DEFAULT_CHARACTER_SETTINGS,
  EXTRAS,
  LANGUAGES,
  LEVEL_PRESETS,
  impliedExtras,
  languageFromCoverage,
  levelPresetIds,
  requiredPresetIds,
} from './character-settings';

describe('字符范围设置', () => {
  it('每种语言两档字表 ID 格式合法，完整档不少于常用档', () => {
    for (const language of LANGUAGES) {
      for (const level of ['common', 'full'] as const) {
        for (const id of LEVEL_PRESETS[language][level]) expect(id).toMatch(/^[a-z][a-z\d-]+$/u);
      }
    }
    expect(COVERAGE_LEVELS).toEqual(['text', 'common', 'full', 'all']);
    expect(levelPresetIds('hans', 'common')).toEqual(['sc-tgh-1', ...BASE_PRESET_IDS]);
    expect(levelPresetIds('hant-hk', 'text')).toEqual([]);
    expect(levelPresetIds('hant-tw', 'all')).toEqual([]);
  });

  it('合并档位、附加字符与字表库并去重；全部字符时不需要任何字表', () => {
    const ids = requiredPresetIds(
      { ...DEFAULT_CHARACTER_SETTINGS, extras: ['kana'], libraryIds: ['sc-gbk', 'sc-tgh-1'] },
      'hans',
      ['kana', 'hangul'],
    );
    expect(ids).toContain('sc-tgh-1');
    expect(ids).toContain('f-latin-ascii');
    expect(ids).toContain('u-kana');
    expect(ids).toContain('u-hangul');
    expect(ids).toContain('sc-gbk');
    expect(new Set(ids).size).toBe(ids.length);
    expect(requiredPresetIds({ ...DEFAULT_CHARACTER_SETTINGS, level: 'all' }, 'hans')).toEqual([]);
    expect(requiredPresetIds({ ...DEFAULT_CHARACTER_SETTINGS, level: 'text' }, 'hans')).toEqual([]);
  });

  it('从用户文本推断假名与谚文，但只在字体提供这些字形时补整套', () => {
    expect(impliedExtras([0x4e00], null)).toEqual([]);
    expect(impliedExtras([0x3042], null)).toEqual(['kana']);
    expect(impliedExtras([0xac00, 0x30a2], null)).toEqual(['kana', 'hangul']);
    expect(impliedExtras([0xac00, 0x30a2], [0x4e00, 0x30a0])).toEqual(['kana']);
    expect(impliedExtras([0xac00], [0x4e00])).toEqual([]);
    // 只有兼容字母、没有音节的字体不算支持韩文
    expect(impliedExtras([0xac00], [0x4e00, 0x3131])).toEqual([]);
    expect(impliedExtras([0xac00], [0x4e00, 0xac01])).toEqual(['hangul']);
    expect(EXTRAS.map((extra) => extra.id)).toContain('kana');
  });

  it('按代表字表覆盖比例判断语言，都不足九成时不判断', () => {
    expect(languageFromCoverage({ hans: 0.99, 'hant-tw': 0.95, 'hant-hk': null })).toBe('hans');
    expect(languageFromCoverage({ hans: 0.6, 'hant-tw': 0.97, 'hant-hk': 0.96 })).toBe('hant-tw');
    expect(languageFromCoverage({ hans: 0.5, 'hant-tw': 0.4, 'hant-hk': null })).toBeNull();
  });
});
