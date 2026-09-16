import {
  COVERAGE_LEVELS,
  DETECTION_PRESETS,
  LANGUAGES,
  impliedExtras,
  languageFromCoverage,
  levelPresetIds,
  profileOf,
  requiredPresetIds,
  type CharacterSettings,
  type CoverageLevel,
  type ExtraId,
  type Language,
} from '../core/character-settings';
import type { CharsetPreset } from '../core/charset-store';
import {
  cyrb53,
  intersectSorted,
  toSortedUnique,
  unionSorted,
  type CodePointList,
} from '../core/codepoints';
import {
  availableFor,
  createCostModel,
  createExportPlan,
  defaultFaceDraft,
  type CharacterTarget,
  type ExportPlan,
  type FaceDraft,
  type FaceSource,
} from '../core/export-plan';
import { classifyFontScript, WESTERN_LEVEL_RANGES, type FontScript } from '../core/font-script';
import {
  EMPTY_FREQUENCY,
  createUsageModel,
  type FrequencyData,
  type TextProfile,
  type UsageModel,
} from '../core/frequency';
import { evaluateShards, profileMetrics, type PageProfileId } from '../core/plan-metrics';
import { filterByRanges, type CodePointRange } from '../core/range-codec';
import { estimateSingleFileBytes, planShards, type PlanSettings } from '../core/shard-planner';
import { extractCodePoints, isHanCodePoint, textStatistics } from '../core/text-extract';
import { parseUnicodeInput, type UnicodeInputError } from '../core/unicode-input';
import { memoizeLast } from './store';
import type { AppState, DataState, FontEntry } from './state';

// ---------------------------------------------------------------------------
// 语言
// ---------------------------------------------------------------------------

const customStatistics = memoizeLast((text: string) => textStatistics(text));

function likelihood(frequency: FrequencyData, profile: TextProfile, text: string): number {
  const table = frequency.profiles[profile];
  const rank = new Map(
    table.codePoints.map((codePoint, index) => [codePoint, table.counts[index] ?? 0]),
  );
  let score = 0;
  for (const character of text.slice(0, 20000)) {
    score += Math.log1p(rank.get(character.codePointAt(0) ?? 0) ?? 0);
  }
  return score;
}

const firstReadyCoverage = memoizeLast((fonts: readonly FontEntry[]): CodePointList | null => {
  for (const font of fonts) {
    if (font.status === 'ready' && font.inspection !== null) return font.inspection.coverage;
  }
  return null;
});

const fontScript = memoizeLast((coverage: CodePointList | null): FontScript =>
  coverage === null ? 'cjk' : classifyFontScript(coverage),
);

/** 首个就绪字体的文字类型；还没有字体时按 CJK 展示。 */
export function selectFontScript(state: AppState): FontScript {
  return fontScript(firstReadyCoverage(state.fonts));
}

export interface LanguageDetection {
  readonly language: Language;
  /** 判断依据：显式设置、字体覆盖、用户文本，或尚无依据时的默认值。 */
  readonly basis: 'setting' | 'font' | 'text' | 'default';
}

const detectLanguage = memoizeLast(
  (
    settings: CharacterSettings,
    coverage: CodePointList | null,
    presets: ReadonlyMap<string, CharsetPreset>,
    frequency: FrequencyData | null,
  ): LanguageDetection => {
    if (settings.language !== 'auto') return { language: settings.language, basis: 'setting' };
    // 用户粘贴的文本最能说明站点语言；字频数据就绪后按简繁似然判断。
    const text = settings.customText;
    if (frequency !== null && text.trim().length >= 20) {
      const hant = likelihood(frequency, 'hant', text);
      const hans = likelihood(frequency, 'hans', text);
      if (hant > hans * 1.05) return { language: 'hant-tw', basis: 'text' };
      if (hans > hant * 1.05) return { language: 'hans', basis: 'text' };
    }
    if (coverage !== null) {
      const ratios = Object.fromEntries(
        LANGUAGES.map((language) => {
          const preset = presets.get(DETECTION_PRESETS[language]);
          return [
            language,
            preset === undefined
              ? null
              : intersectSorted(preset.codePoints, coverage).length / preset.codePoints.length,
          ];
        }),
      ) as Record<Language, number | null>;
      const detected = languageFromCoverage(ratios);
      if (detected !== null) return { language: detected, basis: 'font' };
    }
    return { language: 'hans', basis: 'default' };
  },
);

export function selectLanguageDetection(state: AppState): LanguageDetection {
  return detectLanguage(
    state.characters,
    firstReadyCoverage(state.fonts),
    state.data.presets,
    state.data.frequency,
  );
}

export function selectLanguage(state: AppState): Language {
  return selectLanguageDetection(state).language;
}

export function selectTextProfile(state: AppState): TextProfile {
  return profileOf(selectLanguage(state));
}

// ---------------------------------------------------------------------------
// 目标字符
// ---------------------------------------------------------------------------

export interface CharacterTargetState {
  readonly status: 'loading' | 'ready' | 'error';
  readonly script: FontScript;
  readonly presetIds: readonly string[];
  readonly presetCodePoints: CodePointList;
  /** 所选档位在首个字体中已经覆盖的字符（不含自定义文本），用于提示文本补入了哪些字。 */
  readonly rangeCodePoints: CodePointList;
  readonly customCodePoints: CodePointList;
  readonly requested: CodePointList;
  readonly allFontCharacters: boolean;
  /** 西文字体按区块保留字体自身字符的区间；CJK 字体为空。 */
  readonly fontRanges: readonly CodePointRange[];
  /** 由用户文本推断出的附加字符（假名、谚文）。 */
  readonly impliedExtras: readonly ExtraId[];
  readonly rangeErrors: readonly UnicodeInputError[];
  readonly failedPresetIds: readonly string[];
}

const customCodePoints = memoizeLast(
  (
    text: string,
    ranges: string,
  ): { codePoints: number[]; errors: readonly UnicodeInputError[] } => {
    const parsed = parseUnicodeInput(ranges);
    return {
      codePoints: toSortedUnique([...extractCodePoints(text), ...parsed.codePoints]),
      errors: parsed.errors,
    };
  },
);

const presetUnion = memoizeLast(
  (ids: string, presets: ReadonlyMap<string, CharsetPreset>): number[] =>
    unionSorted(
      ids
        .split(',')
        .filter(Boolean)
        .map((id) => presets.get(id)?.codePoints ?? []),
    ),
);

/** 西文字体在某一档按区块保留的字体字符区间。 */
function fontRangesFor(script: FontScript, level: CoverageLevel): readonly CodePointRange[] {
  return script === 'western' && (level === 'common' || level === 'full')
    ? WESTERN_LEVEL_RANGES[level]
    : [];
}

const characterTarget = memoizeLast(
  (
    settings: CharacterSettings,
    language: Language,
    data: DataState,
    coverage: CodePointList | null,
    script: FontScript,
  ): CharacterTargetState => {
    const custom = customCodePoints(settings.customText, settings.customRanges);
    const implied = script === 'cjk' ? impliedExtras(custom.codePoints, coverage) : [];
    const ids = requiredPresetIds(settings, language, implied, script);
    const failed = ids.filter((id) => data.failedPresetIds.has(id));
    const loaded = ids.every((id) => data.presets.has(id));
    const presetCodePoints = loaded ? presetUnion(ids.join(','), data.presets) : [];
    const fontRanges = fontRangesFor(script, settings.level);
    return {
      status: failed.length > 0 ? 'error' : loaded ? 'ready' : 'loading',
      script,
      presetIds: ids,
      presetCodePoints,
      rangeCodePoints:
        fontRanges.length > 0 && coverage !== null
          ? unionSorted([filterByRanges(coverage, fontRanges), presetCodePoints])
          : presetCodePoints,
      customCodePoints: custom.codePoints,
      requested: loaded ? unionSorted([presetCodePoints, custom.codePoints]) : custom.codePoints,
      allFontCharacters: settings.level === 'all',
      fontRanges,
      impliedExtras: implied,
      rangeErrors: custom.errors,
      failedPresetIds: failed,
    };
  },
);

export function selectCharacterTarget(state: AppState): CharacterTargetState {
  return characterTarget(
    state.characters,
    selectLanguage(state),
    state.data,
    firstReadyCoverage(state.fonts),
    selectFontScript(state),
  );
}

/** 当前需要加载的字表：目标集合用到的，加上 CJK 字体判断语言用的代表字表。 */
export function selectRequiredPresetIds(state: AppState): string[] {
  const ids = new Set(selectCharacterTarget(state).presetIds);
  if (state.characters.language === 'auto' && selectFontScript(state) === 'cjk') {
    for (const language of LANGUAGES) ids.add(DETECTION_PRESETS[language]);
  }
  return [...ids];
}

/** 空闲时预取的字表：当前语言其他档位用到的，让切换档位与档位对比即时可用。 */
export function selectPrefetchPresetIds(state: AppState): string[] {
  if (selectFontScript(state) === 'western') return [];
  const language = selectLanguage(state);
  const ids = new Set<string>();
  for (const level of COVERAGE_LEVELS)
    for (const id of levelPresetIds(language, level)) ids.add(id);
  return [...ids];
}

// ---------------------------------------------------------------------------
// 字频模型与导出计划
// ---------------------------------------------------------------------------

const usageModel = memoizeLast(
  (frequency: FrequencyData | null, profile: TextProfile, text: string): UsageModel =>
    createUsageModel(frequency ?? EMPTY_FREQUENCY, profile, customStatistics(text)),
);

export function selectUsageModel(state: AppState): UsageModel {
  return usageModel(state.data.frequency, selectTextProfile(state), state.characters.customText);
}

const readyFaces = memoizeLast((fonts: readonly FontEntry[]): FaceSource[] =>
  fonts.flatMap((font) =>
    font.status === 'ready' && font.inspection !== null
      ? [{ id: font.id, inspection: font.inspection }]
      : [],
  ),
);

const draftMap = memoizeLast((fonts: readonly FontEntry[]): ReadonlyMap<string, FaceDraft> => {
  const drafts = new Map<string, FaceDraft>();
  for (const font of fonts) {
    if (font.inspection !== null)
      drafts.set(font.id, font.draft ?? defaultFaceDraft(font.inspection));
  }
  return drafts;
});

const exportPlan = memoizeLast(
  (
    fonts: readonly FontEntry[],
    target: CharacterTargetState,
    usage: UsageModel,
    plan: AppState['plan'],
    output: AppState['output'],
  ): ExportPlan | null => {
    const faces = readyFaces(fonts);
    if (faces.length === 0 || target.status !== 'ready') return null;
    return createExportPlan({
      faces,
      drafts: draftMap(fonts),
      target: {
        requested: target.requested,
        allFontCharacters: target.allFontCharacters,
        fontRanges: target.fontRanges,
      },
      usage,
      planSettings: plan,
      output,
    });
  },
);

export function selectExportPlan(state: AppState): ExportPlan | null {
  return exportPlan(
    state.fonts,
    selectCharacterTarget(state),
    selectUsageModel(state),
    state.plan,
    state.output,
  );
}

// ---------------------------------------------------------------------------
// 覆盖范围四档对比
// ---------------------------------------------------------------------------

export interface LevelEstimate {
  readonly level: CoverageLevel;
  /** 该档在首个字体中可用的字符数；字表未载入时为 null。 */
  readonly characters: number | null;
  readonly shardCount: number | null;
  readonly totalBytes: number | null;
  /** 当前页面长度下的每页期望下载。 */
  readonly pageBytes: number | null;
  readonly pageRequests: number | null;
  readonly singleFileBytes: number | null;
}

const levelEstimates = memoizeLast(
  (
    fonts: readonly FontEntry[],
    settings: CharacterSettings,
    language: Language,
    data: DataState,
    usage: UsageModel,
    plan: PlanSettings,
    pageProfile: PageProfileId,
    script: FontScript,
  ): readonly LevelEstimate[] => {
    const coverage = firstReadyCoverage(fonts);
    const face = readyFaces(fonts)[0];
    const custom = customCodePoints(settings.customText, settings.customRanges);
    const implied = script === 'cjk' ? impliedExtras(custom.codePoints, coverage) : [];
    return COVERAGE_LEVELS.map((level) => {
      const empty: LevelEstimate = {
        level,
        characters: null,
        shardCount: null,
        totalBytes: null,
        pageBytes: null,
        pageRequests: null,
        singleFileBytes: null,
      };
      if (coverage === null || face === undefined) return empty;
      const ids = requiredPresetIds({ ...settings, level }, language, implied, script);
      if (!ids.every((id) => data.presets.has(id))) return empty;
      const target: CharacterTarget = {
        requested: unionSorted([presetUnion(ids.join(','), data.presets), custom.codePoints]),
        allFontCharacters: level === 'all',
        fontRanges: fontRangesFor(script, level),
      };
      const available = availableFor(target, coverage);
      if (available.length === 0) return { ...empty, characters: 0 };
      const costs = createCostModel(face.inspection, face.inspection.variable);
      const shards = planShards(available, usage, costs, plan).shards;
      const metrics = profileMetrics(
        evaluateShards(
          shards.map((shard) => ({
            kind: shard.kind,
            mass: shard.mass,
            bytes: shard.estimatedBytes,
          })),
        ),
        pageProfile,
      );
      return {
        level,
        characters: available.length,
        shardCount: shards.length,
        totalBytes: shards.reduce((total, shard) => total + shard.estimatedBytes, 0),
        pageBytes: metrics.expectedBytes,
        pageRequests: metrics.expectedRequests,
        singleFileBytes: estimateSingleFileBytes(available, usage, costs),
      };
    });
  },
);

export function selectLevelEstimates(state: AppState): readonly LevelEstimate[] {
  return levelEstimates(
    state.fonts,
    state.characters,
    selectLanguage(state),
    state.data,
    selectUsageModel(state),
    state.plan,
    state.pageProfile,
    selectFontScript(state),
  );
}

/**
 * 首个字体几乎不含汉字时（代码、拉丁、图标字体，或只有假名谚文的字体），
 * "全部字符"才是合理的默认：这类字体本身不大，制表符、箭头、图标也常被用到，
 * 而按文字分片后每页下载几乎不变。
 */
export function selectRecommendedLevel(state: AppState): CoverageLevel {
  const coverage = firstReadyCoverage(state.fonts);
  if (coverage === null) return 'common';
  if (selectFontScript(state) === 'western') return 'all';
  let han = 0;
  for (const codePoint of coverage) {
    if (isHanCodePoint(codePoint)) han += 1;
    if (han >= 100) return 'common';
  }
  return 'all';
}

// ---------------------------------------------------------------------------
// 阻塞项与结果指纹
// ---------------------------------------------------------------------------

export type Blocker =
  | { readonly code: 'no-fonts' }
  | { readonly code: 'checking' }
  | { readonly code: 'inspecting'; readonly count: number }
  | { readonly code: 'font-error'; readonly id: string; readonly name: string }
  | { readonly code: 'characters-loading' }
  | { readonly code: 'characters-error' }
  | { readonly code: 'range-error' }
  | { readonly code: 'running' };

export function selectBlockers(state: AppState): Blocker[] {
  const blockers: Blocker[] = [];
  if (state.run.phase === 'running') blockers.push({ code: 'running' });
  if (state.fonts.length === 0) blockers.push({ code: 'no-fonts' });
  if (state.checkingFiles > 0) blockers.push({ code: 'checking' });
  const inspecting = state.fonts.filter(
    (font) => font.status === 'queued' || font.status === 'inspecting',
  );
  if (inspecting.length > 0) blockers.push({ code: 'inspecting', count: inspecting.length });
  for (const font of state.fonts) {
    if (font.status === 'error')
      blockers.push({ code: 'font-error', id: font.id, name: font.file.name });
  }
  const target = selectCharacterTarget(state);
  if (target.status === 'loading') blockers.push({ code: 'characters-loading' });
  if (target.status === 'error') blockers.push({ code: 'characters-error' });
  if (target.rangeErrors.length > 0) blockers.push({ code: 'range-error' });
  return blockers;
}

/**
 * 影响分片字节的全部输入的指纹。结果记录生成时的指纹，二者不一致即为过期结果。
 * 只影响 CSS 文本的设置（路径、font-display）不计入：改动后即时重新生成文本。
 */
const inputKey = memoizeLast(
  (
    fonts: readonly FontEntry[],
    target: CharacterTargetState,
    profile: TextProfile,
    customText: string,
    plan: AppState['plan'],
    output: AppState['output'],
    frequencyLoaded: boolean,
  ): string => {
    const fontPart = fonts
      .map((font) => `${font.id}:${font.status}:${JSON.stringify(font.draft)}`)
      .join('|');
    return [
      fontPart,
      cyrb53(target.requested).toString(36),
      String(target.allFontCharacters),
      JSON.stringify(target.fontRanges),
      profile,
      cyrb53(customText).toString(36),
      JSON.stringify(plan),
      [output.keepHinting, output.cjkFeatures, output.trimMetadata].join(','),
      String(frequencyLoaded),
    ].join('#');
  },
);

export function selectInputKey(state: AppState): string {
  return inputKey(
    state.fonts,
    selectCharacterTarget(state),
    selectTextProfile(state),
    state.characters.customText,
    state.plan,
    state.output,
    state.data.frequency !== null,
  );
}
