import type { TextProfile } from './frequency';
import type { FontScript } from './font-script';

/**
 * 字符范围由两个问题决定：网站用什么语言、要覆盖多广。
 *
 * - 语言决定用哪套标准字表和哪份字频档案；默认自动按字体覆盖与用户文本判断。
 * - 覆盖范围是从小到大的四档阶梯：仅文本 → 常用 → 完整 → 全部。
 * - 用户粘贴的文本总是并入目标集合，并让其中的字优先进入靠前的分片。
 *
 * 常用/完整两档自动附带拉丁字母、数字与中西文标点；高级设置里可以再加
 * 假名、谚文等附加字符或任意标准字表。
 *
 * 西文字体（见 `font-script.ts`）沿用同一组档位，但中间两档改为按 Unicode
 * 区块取字体自身的字符（西欧 / 多语言），不引用汉字字表，也不使用附加字符。
 */
export type Language = 'hans' | 'hant-tw' | 'hant-hk';
export type LanguageSetting = 'auto' | Language;
export type CoverageLevel = 'text' | 'common' | 'full' | 'all';

export const LANGUAGES: readonly Language[] = ['hans', 'hant-tw', 'hant-hk'];
export const COVERAGE_LEVELS: readonly CoverageLevel[] = ['text', 'common', 'full', 'all'];

/** 每种语言在"常用"与"完整"两档使用的标准字表。 */
export const LEVEL_PRESETS: Readonly<
  Record<Language, Readonly<Record<'common' | 'full', readonly string[]>>>
> = {
  hans: { common: ['sc-tgh-1'], full: ['sc-tgh-full'] },
  'hant-tw': { common: ['tc-moe-common', 'tc-big5-common'], full: ['tc-big5-full'] },
  'hant-hk': { common: ['tc-hk-common'], full: ['tc-hk-common', 'tc-hkscs'] },
};

/** 用于自动判断语言的代表字表：字体覆盖哪一份，就按哪种语言。 */
export const DETECTION_PRESETS: Readonly<Record<Language, string>> = {
  hans: 'sc-tgh-1',
  'hant-tw': 'tc-moe-common',
  'hant-hk': 'tc-hk-common',
};

/** 几乎每个中文网页都会用到的非汉字字符，常用/完整两档自动包含。 */
export const BASE_PRESET_IDS: readonly string[] = [
  'f-latin-ascii',
  'f-punct-cn',
  'u-cjk-punct',
  'f-punct-west',
  'f-digits-cjk',
];

export type ExtraId = 'symbols' | 'latin-1' | 'pinyin' | 'fullwidth' | 'kana' | 'hangul';

export interface Extra {
  readonly id: ExtraId;
  readonly presetIds: readonly string[];
  readonly name: readonly [zh: string, en: string];
  readonly sample: string;
}

export const EXTRAS: readonly Extra[] = [
  { id: 'symbols', presetIds: ['f-symbols'], name: ['常用符号', 'Symbols'], sample: '¥ → ±' },
  { id: 'latin-1', presetIds: ['f-latin-1'], name: ['Latin-1', 'Latin-1'], sample: 'é ü ©' },
  { id: 'pinyin', presetIds: ['f-latin-ext-a'], name: ['拼音声调', 'Pinyin tones'], sample: 'ā ǒ' },
  {
    id: 'fullwidth',
    presetIds: ['u-fullwidth'],
    name: ['全角字母', 'Fullwidth forms'],
    sample: 'Ａ１',
  },
  { id: 'kana', presetIds: ['u-kana'], name: ['日文假名', 'Kana'], sample: 'あア' },
  { id: 'hangul', presetIds: ['u-hangul'], name: ['韩文', 'Hangul'], sample: '한글' },
];

export interface CharacterSettings {
  readonly language: LanguageSetting;
  readonly level: CoverageLevel;
  /** 高级设置中勾选的附加字符。 */
  readonly extras: readonly ExtraId[];
  /** 字表库中额外勾选的标准字表。 */
  readonly libraryIds: readonly string[];
  readonly customText: string;
  readonly customRanges: string;
}

export const DEFAULT_CHARACTER_SETTINGS: CharacterSettings = {
  language: 'auto',
  level: 'common',
  extras: [],
  libraryIds: [],
  customText: '',
  customRanges: '',
};

export function profileOf(language: Language): TextProfile {
  return language === 'hans' ? 'hans' : 'hant';
}

/** 某一档在某种语言下引用的全部标准字表（不含附加与字表库）。 */
export function levelPresetIds(language: Language, level: CoverageLevel): readonly string[] {
  if (level === 'text' || level === 'all') return [];
  return [...LEVEL_PRESETS[language][level], ...BASE_PRESET_IDS];
}

function isKana(codePoint: number): boolean {
  return codePoint >= 0x3041 && codePoint <= 0x30ff;
}

function isHangul(codePoint: number): boolean {
  return (
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x3131 && codePoint <= 0x318e)
  );
}

function hasAny(codePoints: Iterable<number>, test: (codePoint: number) => boolean): boolean {
  for (const codePoint of codePoints) if (test(codePoint)) return true;
  return false;
}

/**
 * 用户文本里出现了假名或谚文、而字体也提供这套字形时，自动补上整套字符。
 * 字体不含该文字时不补：整套加进去只会变成上万个缺字。
 */
export function impliedExtras(
  customCodePoints: Iterable<number>,
  fontCoverage: Iterable<number> | null,
): ExtraId[] {
  const custom = [...customCodePoints];
  const coverage = fontCoverage === null ? null : [...fontCoverage];
  // 字体是否真的提供这套文字：看假名区与谚文音节区，很多中文字体只带兼容字母。
  const supports = (test: (codePoint: number) => boolean) =>
    coverage === null || hasAny(coverage, test);
  const kana = hasAny(custom, isKana) && supports(isKana);
  const hangul =
    hasAny(custom, isHangul) && supports((codePoint) => codePoint >= 0xac00 && codePoint <= 0xd7a3);
  return [...(kana ? (['kana'] as const) : []), ...(hangul ? (['hangul'] as const) : [])];
}

/** 当前设置在已解析语言下需要加载的全部字表 ID（去重、保持顺序）。 */
export function requiredPresetIds(
  settings: CharacterSettings,
  language: Language,
  implied: readonly ExtraId[] = [],
  script: FontScript = 'cjk',
): string[] {
  const ids = new Set<string>();
  if (settings.level !== 'all') {
    // 西文字体的档位按区块取字体自身字符，附加字符面向中文网页，不再适用。
    if (script === 'cjk') {
      for (const id of levelPresetIds(language, settings.level)) ids.add(id);
      const extras = new Set<ExtraId>([...settings.extras, ...implied]);
      for (const extra of EXTRAS) {
        if (!extras.has(extra.id)) continue;
        for (const id of extra.presetIds) ids.add(id);
      }
    }
    for (const id of settings.libraryIds) ids.add(id);
  }
  return [...ids];
}

/** 字体覆盖了哪种语言的代表字表：按覆盖比例取最高，都不足九成时返回 null。 */
export function languageFromCoverage(
  ratios: Readonly<Record<Language, number | null>>,
): Language | null {
  let best: Language | null = null;
  let bestRatio = 0.9;
  for (const language of LANGUAGES) {
    const ratio = ratios[language];
    if (ratio !== null && ratio > bestRatio) {
      best = language;
      bestRatio = ratio;
    }
  }
  return best;
}
