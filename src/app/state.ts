import {
  COVERAGE_LEVELS,
  DEFAULT_CHARACTER_SETTINGS,
  EXTRAS,
  LANGUAGES,
  type CharacterSettings,
} from '../core/character-settings';
import type { CharsetIndex, CharsetPreset } from '../core/charset-store';
import { FONT_DISPLAY_VALUES } from '../core/css-gen';
import type { FaceDraft, OutputSettings } from '../core/export-plan';
import type { FontInspection } from '../core/font-inspection';
import type { FrequencyData } from '../core/frequency';
import type { PackageContext } from '../core/output-package';
import type { PageProfileId } from '../core/plan-metrics';
import { DEFAULT_PLAN_SETTINGS, type PlanSettings } from '../core/shard-planner';
import type { FontUploadRejectionCode } from './validate-font-uploads';

export type FontStatus = 'queued' | 'inspecting' | 'ready' | 'error';

export interface FontEntry {
  readonly id: string;
  readonly file: File;
  readonly status: FontStatus;
  readonly inspection: FontInspection | null;
  readonly error: string | null;
  readonly draft: FaceDraft | null;
}

export interface RejectedFile {
  readonly id: string;
  readonly name: string;
  readonly code: FontUploadRejectionCode;
}

export interface DataState {
  readonly index: CharsetIndex | null;
  readonly presets: ReadonlyMap<string, CharsetPreset>;
  readonly failedPresetIds: ReadonlySet<string>;
  readonly frequency: FrequencyData | null;
  readonly frequencyFailed: boolean;
}

export type RunPhase = 'idle' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunProgress {
  readonly total: number;
  readonly completed: number;
  readonly bytes: number;
  readonly startedAt: number;
  readonly threads: number;
  /** 已完成分片：`${outputId}|${shardKey}`。 */
  readonly done: ReadonlySet<string>;
  readonly current: string;
}

export interface RunResult {
  readonly id: number;
  readonly inputKey: string;
  /** 生成时的全部输出上下文；文案与只影响 CSS 的设置按当前界面即时生成。 */
  readonly context: Omit<PackageContext, 'locale'>;
  /** 文件名 → WOFF2 字节，用于 ZIP 与实时预览。 */
  readonly shardData: ReadonlyMap<string, ArrayBuffer>;
}

export interface RunState {
  readonly phase: RunPhase;
  readonly progress: RunProgress | null;
  readonly result: RunResult | null;
  readonly error: string | null;
}

export interface AppState {
  readonly fonts: readonly FontEntry[];
  readonly rejected: readonly RejectedFile[];
  readonly checkingFiles: number;
  readonly characters: CharacterSettings;
  /** 用户是否手动改过字符设置；未改过时可根据字体覆盖自动推荐覆盖范围。 */
  readonly charactersTouched: boolean;
  readonly plan: PlanSettings;
  readonly output: OutputSettings;
  readonly pageProfile: PageProfileId;
  readonly data: DataState;
  readonly run: RunState;
}

export const DEFAULT_OUTPUT_SETTINGS: OutputSettings = {
  urlPrefix: '',
  fontDisplay: 'swap',
  keepHinting: false,
  cjkFeatures: true,
  trimMetadata: true,
};

export function initialState(persisted: Partial<PersistedSettings> = {}): AppState {
  return {
    fonts: [],
    rejected: [],
    checkingFiles: 0,
    characters: { ...DEFAULT_CHARACTER_SETTINGS, ...persisted.characters, customText: '' },
    charactersTouched: persisted.characters !== undefined,
    plan: { ...DEFAULT_PLAN_SETTINGS, ...persisted.plan },
    output: { ...DEFAULT_OUTPUT_SETTINGS, ...persisted.output },
    pageProfile: persisted.pageProfile ?? 'article',
    data: {
      index: null,
      presets: new Map(),
      failedPresetIds: new Set(),
      frequency: null,
      frequencyFailed: false,
    },
    run: { phase: 'idle', progress: null, result: null, error: null },
  };
}

// ---------------------------------------------------------------------------
// 本地偏好持久化（只存设置；字体、正文与结果不写入存储）
// ---------------------------------------------------------------------------

export interface PersistedSettings {
  readonly characters: Omit<CharacterSettings, 'customText'>;
  readonly plan: PlanSettings;
  readonly output: OutputSettings;
  readonly pageProfile: PageProfileId;
}

const STORAGE_KEY = 'webfont-slice:settings:v3';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickBoolean(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof source[key] === 'boolean' ? source[key] : fallback;
}

function pickNumber(
  source: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function pickString(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
  maxLength = 2048,
): string {
  const value = source[key];
  return typeof value === 'string' && value.length <= maxLength ? value : fallback;
}

function pickOneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** 严格校验读入的偏好；任何异常字段回落到默认值。 */
export function parsePersistedSettings(value: unknown): Partial<PersistedSettings> {
  if (!isRecord(value)) return {};
  const result: { -readonly [K in keyof PersistedSettings]?: PersistedSettings[K] } = {};
  if (isRecord(value.plan)) {
    const plan = value.plan;
    result.plan = {
      strategy: pickOneOf(plan.strategy, ['smart', 'single'], DEFAULT_PLAN_SETTINGS.strategy),
      granularity: pickNumber(plan, 'granularity', DEFAULT_PLAN_SETTINGS.granularity, 1, 7),
    };
  }
  if (isRecord(value.output)) {
    const output = value.output;
    result.output = {
      urlPrefix: pickString(output, 'urlPrefix', DEFAULT_OUTPUT_SETTINGS.urlPrefix),
      fontDisplay: pickOneOf(
        output.fontDisplay,
        FONT_DISPLAY_VALUES,
        DEFAULT_OUTPUT_SETTINGS.fontDisplay,
      ),
      keepHinting: pickBoolean(output, 'keepHinting', DEFAULT_OUTPUT_SETTINGS.keepHinting),
      cjkFeatures: pickBoolean(output, 'cjkFeatures', DEFAULT_OUTPUT_SETTINGS.cjkFeatures),
      trimMetadata: pickBoolean(output, 'trimMetadata', DEFAULT_OUTPUT_SETTINGS.trimMetadata),
    };
  }
  if (isRecord(value.characters)) {
    const characters = value.characters;
    const extraIds = new Set<string>(EXTRAS.map((extra) => extra.id));
    result.characters = {
      language: pickOneOf(
        characters.language,
        ['auto', ...LANGUAGES],
        DEFAULT_CHARACTER_SETTINGS.language,
      ),
      level: pickOneOf(characters.level, COVERAGE_LEVELS, DEFAULT_CHARACTER_SETTINGS.level),
      extras: Array.isArray(characters.extras)
        ? (characters.extras.filter((id) =>
            extraIds.has(String(id)),
          ) as CharacterSettings['extras'])
        : DEFAULT_CHARACTER_SETTINGS.extras,
      libraryIds: Array.isArray(characters.libraryIds)
        ? characters.libraryIds.filter(
            (id): id is string => typeof id === 'string' && /^[a-z][a-z\d-]+$/u.test(id),
          )
        : [],
      customRanges: pickString(characters, 'customRanges', '', 4096),
    };
  }
  result.pageProfile = pickOneOf(value.pageProfile, ['headline', 'article', 'longform'], 'article');
  return result;
}

export function loadPersistedSettings(): Partial<PersistedSettings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : parsePersistedSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function savePersistedSettings(state: AppState): void {
  const { language, level, extras, libraryIds, customRanges } = state.characters;
  const value: PersistedSettings = {
    characters: { language, level, extras, libraryIds, customRanges },
    plan: state.plan,
    output: state.output,
    pageProfile: state.pageProfile,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 存储不可用时不影响本地处理。
  }
}
