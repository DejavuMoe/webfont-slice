import type { CharacterSettings } from '../core/character-settings';
import { hashHex } from '../core/codepoints';
import { validateUrlPrefix } from '../core/css-gen';
import {
  defaultFaceDraft,
  shardFileName,
  type ExportOutput,
  type FaceDraft,
  type OutputSettings,
  type TextOutputSettings,
} from '../core/export-plan';
import {
  buildPackageTexts,
  packageFiles,
  withMeasuredMetrics,
  type GeneratedOutput,
  type GeneratedShard,
  type OutputLocale,
  type PackageContext,
  type PackageTexts,
} from '../core/output-package';
import type { PageProfileId } from '../core/plan-metrics';
import type { PlanSettings, PlannedShard } from '../core/shard-planner';
import { recommendedThreads, type DeviceProfile } from '../core/threads';
import type { CharsetRepository, FontEngine, SubsetSession } from './ports';
import {
  selectBlockers,
  selectCharacterTarget,
  selectExportPlan,
  selectInputKey,
  selectPrefetchPresetIds,
  selectRecommendedLevel,
  selectRequiredPresetIds,
  selectTextProfile,
} from './derive';
import { savePersistedSettings, type AppState, type FontEntry, type RunResult } from './state';
import type { Store } from './store';
import { validateFontUploads } from './validate-font-uploads';

export interface ControllerDependencies {
  readonly store: Store<AppState>;
  readonly engine: FontEngine;
  readonly repository: CharsetRepository;
  readonly device: DeviceProfile;
  readonly validateShard: (data: ArrayBuffer) => Promise<void>;
  readonly appVersion: string;
}

export interface ResultPackage {
  readonly texts: PackageTexts;
  readonly files: Map<string, Uint8Array | string>;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 规划输出 + 实际分片 → 结果输出（去掉只在规划阶段使用的字段）。 */
function toGenerated(
  output: ExportOutput,
  shards: readonly GeneratedShard[],
): Omit<GeneratedOutput, 'metrics'> {
  return {
    id: output.id,
    sourceId: output.sourceId,
    sourceFileName: output.sourceFileName,
    sourceSize: output.sourceSize,
    variantId: output.variantId,
    instanceName: output.instanceName,
    family: output.family,
    filePrefix: output.filePrefix,
    postScriptName: output.postScriptName,
    weight: output.weight,
    ...(output.stretch === undefined ? {} : { stretch: output.stretch }),
    style: output.style,
    variationMode: output.variationMode,
    ...(output.variationCoordinates === undefined
      ? {}
      : { variationCoordinates: output.variationCoordinates }),
    monospace: output.monospace,
    singleFileBytes: output.singleFileBytes,
    availableCount: output.available.length,
    missing: output.missing,
    shards,
  };
}

const INSPECTION_CONCURRENCY = 3;

export class AppController {
  readonly #deps: ControllerDependencies;
  #fontSequence = 0;
  #runSequence = 0;
  #run: AbortController | null = null;
  #uploads = new AbortController();
  #inspections = new AbortController();
  #activeInspections = 0;
  #pendingPresets = new Set<string>();
  #frequencyPending = false;
  #indexPending = false;
  #recommended = false;
  #trimTimer: ReturnType<typeof setTimeout> | undefined;
  #persistTimer: ReturnType<typeof setTimeout> | undefined;
  #lastPersisted: readonly unknown[] = [];

  constructor(deps: ControllerDependencies) {
    this.#deps = deps;
  }

  get store(): Store<AppState> {
    return this.#deps.store;
  }

  /** 挂载后调用：订阅状态以按需加载数据、持久化偏好。返回清理函数。 */
  start(): () => void {
    const unsubscribe = this.store.subscribe(() => {
      this.#ensureData();
      this.#schedulePersist();
    });
    this.#ensureData();
    this.#pumpInspections();
    const idle = setTimeout(() => {
      for (const id of selectPrefetchPresetIds(this.store.get())) this.#loadPreset(id);
    }, 1200);
    return () => {
      unsubscribe();
      clearTimeout(idle);
      clearTimeout(this.#trimTimer);
      clearTimeout(this.#persistTimer);
      this.#run?.abort();
      this.#uploads.abort();
      this.#inspections.abort();
      this.#deps.engine.terminate();
      // 清理后控制器必须仍可再次 start()：React StrictMode 在开发模式下会
      // 挂载 → 清理 → 再挂载。换上新的 AbortController，并把中断的任务放回队列，
      // 否则之后的上传会拿到已中止的 signal 而被静默丢弃。
      this.#run = null;
      this.#uploads = new AbortController();
      this.#inspections = new AbortController();
      this.#activeInspections = 0;
      this.store.set((state) => ({
        ...state,
        checkingFiles: 0,
        fonts: state.fonts.map((font) =>
          font.status === 'inspecting' ? { ...font, status: 'queued' } : font,
        ),
        run:
          state.run.phase === 'running'
            ? { ...state.run, phase: 'cancelled', progress: null }
            : state.run,
      }));
    };
  }

  // ------------------------------------------------------------------ 数据

  #ensureData(): void {
    const state = this.store.get();
    if (state.data.index === null && !this.#indexPending) {
      this.#indexPending = true;
      void this.#deps.repository
        .loadIndex()
        .then((index) => {
          this.store.set((current) => ({ ...current, data: { ...current.data, index } }));
        })
        .catch(() => undefined)
        .finally(() => {
          this.#indexPending = false;
        });
    }
    if (state.data.frequency === null && !state.data.frequencyFailed && !this.#frequencyPending) {
      this.#frequencyPending = true;
      void this.#deps.repository
        .loadFrequency()
        .then((frequency) => {
          this.store.set((current) => ({ ...current, data: { ...current.data, frequency } }));
        })
        .catch(() => {
          this.store.set((current) => ({
            ...current,
            data: { ...current.data, frequencyFailed: true },
          }));
        })
        .finally(() => {
          this.#frequencyPending = false;
        });
    }
    for (const id of selectRequiredPresetIds(state)) {
      if (!state.data.failedPresetIds.has(id)) this.#loadPreset(id);
    }
  }

  #loadPreset(id: string): void {
    const data = this.store.get().data;
    if (data.presets.has(id) || this.#pendingPresets.has(id)) return;
    this.#pendingPresets.add(id);
    void this.#deps.repository
      .loadPreset(id)
      .then((preset) => {
        this.store.set((current) => {
          const presets = new Map(current.data.presets);
          presets.set(id, preset);
          const failedPresetIds = new Set(current.data.failedPresetIds);
          failedPresetIds.delete(id);
          return { ...current, data: { ...current.data, presets, failedPresetIds } };
        });
      })
      .catch(() => {
        this.store.set((current) => ({
          ...current,
          data: {
            ...current.data,
            failedPresetIds: new Set([...current.data.failedPresetIds, id]),
          },
        }));
      })
      .finally(() => {
        this.#pendingPresets.delete(id);
      });
  }

  retryData(): void {
    this.store.set((current) => ({
      ...current,
      data: { ...current.data, failedPresetIds: new Set(), frequencyFailed: false },
    }));
  }

  #schedulePersist(): void {
    const state = this.store.get();
    const snapshot = [state.characters, state.plan, state.output, state.pageProfile];
    if (snapshot.every((value, index) => Object.is(value, this.#lastPersisted[index]))) return;
    this.#lastPersisted = snapshot;
    clearTimeout(this.#persistTimer);
    this.#persistTimer = setTimeout(() => {
      savePersistedSettings(this.store.get());
    }, 400);
  }

  // ------------------------------------------------------------------ 字体

  async addFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0 || this.store.get().run.phase === 'running') return;
    const signal = this.#uploads.signal;
    this.store.set((state) => ({ ...state, checkingFiles: state.checkingFiles + files.length }));
    try {
      const result = await validateFontUploads(files, signal);
      if (signal.aborted) return;
      const existing = new Set(
        this.store
          .get()
          .fonts.map(
            (font) =>
              `${font.file.name}:${String(font.file.size)}:${String(font.file.lastModified)}`,
          ),
      );
      const entries: FontEntry[] = [];
      for (const { file } of result.accepted) {
        const key = `${file.name}:${String(file.size)}:${String(file.lastModified)}`;
        if (existing.has(key)) continue;
        existing.add(key);
        this.#fontSequence += 1;
        entries.push({
          id: `font-${String(this.#fontSequence)}`,
          file,
          status: 'queued',
          inspection: null,
          error: null,
          draft: null,
        });
      }
      this.store.set((state) => ({
        ...state,
        fonts: [...state.fonts, ...entries],
        rejected: [
          ...state.rejected,
          ...result.rejected.map((rejection) => {
            this.#fontSequence += 1;
            return {
              id: `rejected-${String(this.#fontSequence)}`,
              name: rejection.file.name,
              code: rejection.code,
            };
          }),
        ],
      }));
      this.#pumpInspections();
    } catch (error: unknown) {
      if (!isAbortError(error)) throw error;
    } finally {
      this.store.set((state) => ({
        ...state,
        checkingFiles: Math.max(0, state.checkingFiles - files.length),
      }));
    }
  }

  removeFont(id: string): void {
    if (this.store.get().run.phase === 'running') return;
    this.store.set((state) => ({ ...state, fonts: state.fonts.filter((font) => font.id !== id) }));
  }

  clearFonts(): void {
    if (this.store.get().run.phase === 'running') return;
    this.#uploads.abort();
    this.#uploads = new AbortController();
    this.#inspections.abort();
    this.#inspections = new AbortController();
    this.#activeInspections = 0;
    this.#deps.engine.terminate();
    this.store.set((state) => ({ ...state, fonts: [], rejected: [], checkingFiles: 0 }));
  }

  retryFont(id: string): void {
    this.store.set((state) => ({
      ...state,
      fonts: state.fonts.map((font) =>
        font.id === id && font.status === 'error'
          ? { ...font, status: 'queued', error: null }
          : font,
      ),
    }));
    this.#pumpInspections();
  }

  dismissRejected(id?: string): void {
    this.store.set((state) => ({
      ...state,
      rejected: id === undefined ? [] : state.rejected.filter((item) => item.id !== id),
    }));
  }

  #pumpInspections(): void {
    clearTimeout(this.#trimTimer);
    const signal = this.#inspections.signal;
    while (this.#activeInspections < INSPECTION_CONCURRENCY) {
      const next = this.store.get().fonts.find((font) => font.status === 'queued');
      if (next === undefined) break;
      this.#activeInspections += 1;
      this.#updateFont(next.id, (font) => ({ ...font, status: 'inspecting' }));
      void this.#deps.engine
        .inspect(next.file, signal)
        .then((inspection) => {
          if (signal.aborted) return;
          this.#updateFont(next.id, (font) =>
            font.status === 'inspecting'
              ? {
                  ...font,
                  status: 'ready',
                  inspection,
                  draft: font.draft ?? defaultFaceDraft(inspection),
                }
              : font,
          );
          this.#maybeRecommendLevel();
        })
        .catch((error: unknown) => {
          if (signal.aborted || isAbortError(error)) return;
          this.#updateFont(next.id, (font) =>
            font.status === 'inspecting'
              ? { ...font, status: 'error', error: errorMessage(error) }
              : font,
          );
        })
        .finally(() => {
          if (signal !== this.#inspections.signal) return;
          this.#activeInspections -= 1;
          this.#pumpInspections();
        });
    }
    if (this.#activeInspections === 0) {
      this.#trimTimer = setTimeout(() => {
        if (this.#activeInspections === 0 && this.#run === null) this.#deps.engine.trim();
      }, 8000);
    }
  }

  #updateFont(id: string, updater: (font: FontEntry) => FontEntry): void {
    this.store.set((state) => ({
      ...state,
      fonts: state.fonts.map((font) => (font.id === id ? updater(font) : font)),
    }));
  }

  /** 首个字体就绪后，几乎不含汉字的字体默认改为"全部字符"（用户手动选择过则不干预）。 */
  #maybeRecommendLevel(): void {
    const state = this.store.get();
    if (this.#recommended || state.charactersTouched) return;
    if (!state.fonts.some((font) => font.status === 'ready')) return;
    this.#recommended = true;
    const level = selectRecommendedLevel(state);
    if (level !== state.characters.level) {
      this.store.set((current) => ({
        ...current,
        characters: { ...current.characters, level },
      }));
    }
  }

  // ------------------------------------------------------------------ 设置

  updateCharacters(updater: (settings: CharacterSettings) => CharacterSettings): void {
    this.store.set((state) => {
      const characters = updater(state.characters);
      return characters === state.characters
        ? state
        : { ...state, characters, charactersTouched: true };
    });
  }

  updatePlan(patch: Partial<PlanSettings>): void {
    this.store.set((state) => ({ ...state, plan: { ...state.plan, ...patch } }));
  }

  updateOutput(patch: Partial<OutputSettings>): void {
    this.store.set((state) => ({ ...state, output: { ...state.output, ...patch } }));
  }

  updateDraft(id: string, patch: Partial<FaceDraft>): void {
    this.#updateFont(id, (font) =>
      font.inspection === null
        ? font
        : { ...font, draft: { ...(font.draft ?? defaultFaceDraft(font.inspection)), ...patch } },
    );
  }

  /** 同一原始字族的所有字体一起改名，保证输出为同一个 CSS family。 */
  renameFamily(originalFamily: string, name: string): void {
    this.store.set((state) => ({
      ...state,
      fonts: state.fonts.map((font) =>
        font.inspection?.family === originalFamily
          ? {
              ...font,
              draft: { ...(font.draft ?? defaultFaceDraft(font.inspection)), family: name },
            }
          : font,
      ),
    }));
  }

  /** 文件名前缀与字族名一样按原字族统一修改，同一字族的各字重共用前缀。 */
  setFilePrefix(originalFamily: string, filePrefix: string): void {
    this.store.set((state) => ({
      ...state,
      fonts: state.fonts.map((font) =>
        font.inspection?.family === originalFamily
          ? {
              ...font,
              draft: { ...(font.draft ?? defaultFaceDraft(font.inspection)), filePrefix },
            }
          : font,
      ),
    }));
  }

  setPageProfile(pageProfile: PageProfileId): void {
    this.store.set((state) => ({ ...state, pageProfile }));
  }

  // ------------------------------------------------------------------ 生成

  canGenerate(): boolean {
    const state = this.store.get();
    const plan = selectExportPlan(state);
    return selectBlockers(state).length === 0 && plan !== null && plan.issues.length === 0;
  }

  async generate(): Promise<void> {
    const state = this.store.get();
    const plan = selectExportPlan(state);
    if (selectBlockers(state).length > 0 || plan === null || plan.issues.length > 0) return;

    clearTimeout(this.#trimTimer);
    const runId = (this.#runSequence += 1);
    const controller = new AbortController();
    this.#run = controller;
    const signal = controller.signal;
    const inputKey = selectInputKey(state);
    const startedAt = performance.now();
    this.#setRun(controller, (run) => ({
      ...run,
      phase: 'running',
      error: null,
      progress: {
        total: plan.totalShardCount,
        completed: 0,
        bytes: 0,
        startedAt,
        threads: 0,
        done: new Set(),
        current: '',
      },
    }));

    try {
      const shardData = new Map<string, ArrayBuffer>();
      const generated: GeneratedOutput[] = [];
      let threadsUsed = 0;
      const bySource = new Map<string, ExportOutput[]>();
      for (const output of plan.outputs) {
        const list = bySource.get(output.sourceId);
        if (list === undefined) bySource.set(output.sourceId, [output]);
        else list.push(output);
      }

      for (const [sourceId, outputs] of bySource) {
        const font = state.fonts.find((candidate) => candidate.id === sourceId);
        if (font?.inspection == null) throw new Error('字体已被移除');
        const threads = recommendedThreads(font.inspection.normalizedSize, this.#deps.device);
        const session = await this.#deps.engine.openSession(font.file, sourceId, threads, signal);
        threadsUsed = Math.max(threadsUsed, session.threads);
        this.#setProgress(controller, (progress) => ({ ...progress, threads: threadsUsed }));
        try {
          const results = await Promise.all(
            outputs.map(async (output) => {
              const shards = await Promise.all(
                output.shards.map((shard) =>
                  this.#produceShard({
                    session,
                    output,
                    shard,
                    settings: state.output,
                    shardData,
                    controller,
                  }),
                ),
              );
              return { output, shards };
            }),
          );
          for (const { output, shards } of results) {
            generated.push(withMeasuredMetrics(toGenerated(output, shards)));
          }
        } finally {
          await session.close();
        }
      }
      signal.throwIfAborted();

      const target = selectCharacterTarget(state);
      const context: Omit<PackageContext, 'locale'> = {
        outputs: generated,
        settings: state.output,
        urlPrefix: plan.urlPrefix,
        plan: state.plan,
        characters: {
          presetIds: target.presetIds,
          requestedCount: target.requested.length,
          customCount: target.customCodePoints.length,
          allFontCharacters: target.allFontCharacters,
          textProfile: selectTextProfile(state),
          script: target.script,
        },
        generatedAt: new Date().toISOString(),
        elapsedMs: performance.now() - startedAt,
        threads: threadsUsed,
        totalSourceBytes: plan.totalSourceBytes,
        appVersion: this.#deps.appVersion,
      };
      const result: RunResult = {
        id: runId,
        inputKey,
        context,
        shardData,
      };
      this.#setRun(controller, () => ({ phase: 'done', progress: null, result, error: null }));
    } catch (error: unknown) {
      if (isAbortError(error) || signal.aborted) {
        this.#setRun(controller, (run) => ({ ...run, phase: 'cancelled', progress: null }));
      } else {
        this.#setRun(controller, (run) => ({
          ...run,
          phase: 'error',
          progress: null,
          error: errorMessage(error),
        }));
      }
    } finally {
      if (this.#run === controller) this.#run = null;
      this.#deps.engine.trim();
    }
  }

  async #produceShard(input: {
    readonly session: SubsetSession;
    readonly output: ExportOutput;
    readonly shard: PlannedShard;
    readonly settings: OutputSettings;
    readonly shardData: Map<string, ArrayBuffer>;
    readonly controller: AbortController;
  }): Promise<GeneratedShard> {
    const { session, output, shard, settings, shardData, controller } = input;
    const signal = controller.signal;
    const result = await session.subset(
      {
        codePoints: shard.codePoints,
        keepHinting: settings.keepHinting,
        webFeatures: settings.cjkFeatures,
        trimMetadata: settings.trimMetadata,
        ...(output.variationCoordinates === undefined
          ? {}
          : { variationAxes: output.variationCoordinates }),
      },
      signal,
    );
    signal.throwIfAborted();

    await this.#deps.validateShard(result.data);
    signal.throwIfAborted();
    const bytes = new Uint8Array(result.data);
    const fileName = shardFileName(output, shard.key, hashHex(bytes, 8));
    if (shardData.has(fileName)) throw new Error(`文件名重复：${fileName}`);
    shardData.set(fileName, result.data);
    this.#setProgress(controller, (progress) => {
      const done = new Set(progress.done);
      done.add(`${output.id}|${shard.key}`);
      return {
        ...progress,
        completed: progress.completed + 1,
        bytes: progress.bytes + result.woff2Bytes,
        done,
        current: fileName,
      };
    });
    return {
      key: shard.key,
      kind: shard.kind,
      fileName,
      codePoints: shard.codePoints,
      bytes: result.woff2Bytes,
      sfntBytes: result.sfntBytes,
      estimatedBytes: shard.estimatedBytes,
      mass: shard.mass,
      preload: shard.preload,
    };
  }

  #setRun(controller: AbortController, updater: (run: AppState['run']) => AppState['run']): void {
    if (this.#run !== controller && controller.signal.aborted) return;
    this.store.set((state) => ({ ...state, run: updater(state.run) }));
  }

  #setProgress(
    controller: AbortController,
    updater: (
      progress: NonNullable<AppState['run']['progress']>,
    ) => NonNullable<AppState['run']['progress']>,
  ): void {
    if (this.#run !== controller) return;
    this.store.set((state) =>
      state.run.progress === null
        ? state
        : { ...state, run: { ...state.run, progress: updater(state.run.progress) } },
    );
  }

  cancelRun(): void {
    const controller = this.#run;
    if (controller === null) return;
    controller.abort();
    this.#deps.engine.terminate();
    this.#run = null;
    this.store.set((state) => ({
      ...state,
      run: { ...state.run, phase: 'cancelled', progress: null },
    }));
    // 取消会终止全部线程；仍在排队的字体需要重新分析。
    this.#inspections = new AbortController();
    this.#activeInspections = 0;
    this.store.set((state) => ({
      ...state,
      fonts: state.fonts.map((font) =>
        font.status === 'inspecting' ? { ...font, status: 'queued' } : font,
      ),
    }));
    this.#pumpInspections();
  }

  dismissRunMessage(): void {
    this.store.set((state) =>
      state.run.phase === 'error' || state.run.phase === 'cancelled'
        ? {
            ...state,
            run: { ...state.run, phase: state.run.result === null ? 'idle' : 'done', error: null },
          }
        : state,
    );
  }

  // ------------------------------------------------------------------ 输出

  /** 结果文本按当前语言与只影响 CSS 的设置即时生成，不需要重新子集化。 */
  resultPackage(
    result: RunResult,
    locale: OutputLocale,
    text: TextOutputSettings = this.store.get().output,
  ): ResultPackage {
    const context = result.context;
    let urlPrefix = context.urlPrefix;
    try {
      urlPrefix = validateUrlPrefix(text.urlPrefix);
    } catch {
      // 路径无效时保持生成时的路径；界面会单独提示。
    }
    const texts = buildPackageTexts({
      ...context,
      locale,
      urlPrefix,
      settings: { ...context.settings, ...text, urlPrefix },
    });
    const files = packageFiles({
      texts,
      shards: [...result.shardData].map(([fileName, data]) => ({
        fileName,
        data: new Uint8Array(data),
      })),
    });
    return { texts, files };
  }
}
