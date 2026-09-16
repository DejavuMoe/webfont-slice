import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharsetPreset } from '../core/charset-store';
import type { FontInspection } from '../core/font-inspection';
import type { FrequencyData } from '../core/frequency';
import { fakeInspection } from '../core/test-support';
import { AppController } from './controller';
import { selectBlockers, selectExportPlan, selectInputKey } from './derive';
import type { CharsetRepository, FontEngine, SubsetRequest, SubsetSession } from './ports';
import { initialState, type AppState } from './state';
import { createStore, type Store } from './store';

const han = Array.from({ length: 1200 }, (_, index) => 0x4e00 + index);
const ascii = Array.from({ length: 95 }, (_, index) => 0x20 + index);

function preset(
  id: string,
  codePoints: readonly number[],
  category: CharsetPreset['category'] = 'simplified',
): CharsetPreset {
  return {
    id,
    name: id,
    category,
    expectedCount: codePoints.length,
    standard: 'test',
    description: 'test',
    source: 'https://example.com',
    license: 'test',
    ranges: [],
    codePoints,
  };
}

const PRESETS = new Map<string, CharsetPreset>([
  ['sc-tgh-1', preset('sc-tgh-1', han.slice(0, 900))],
  ['tc-moe-common', preset('tc-moe-common', han.slice(200, 1100), 'traditional')],
  ['f-latin-ascii', preset('f-latin-ascii', ascii, 'functional')],
  ['f-punct-cn', preset('f-punct-cn', [0x3001, 0x3002], 'functional')],
  ['u-cjk-punct', preset('u-cjk-punct', [0x3000, 0x3001, 0x3002], 'unicode')],
  ['f-punct-west', preset('f-punct-west', [0x2014, 0x201c, 0x201d], 'functional')],
  ['f-digits-cjk', preset('f-digits-cjk', [0x3007, 0x2460], 'functional')],
]);

const FREQUENCY: FrequencyData = {
  version: 2,
  source: 'test',
  sourceUrl: '',
  corpusTotal: 1_000_000,
  profiles: {
    hans: {
      codePoints: han.slice(0, 600),
      counts: han.slice(0, 600).map((_, index) => Math.round(50_000 / (index + 1))),
    },
    hant: { codePoints: [], counts: [] },
  },
};

const repository: CharsetRepository = {
  loadIndex: () => Promise.resolve({ version: 2, presets: [...PRESETS.values()] }),
  loadPreset: (id) => {
    const found = PRESETS.get(id);
    return found === undefined
      ? Promise.reject(new Error(`missing ${id}`))
      : Promise.resolve(found);
  },
  loadFrequency: () => Promise.resolve(FREQUENCY),
};

class FakeEngine implements FontEngine {
  readonly inspections = new Map<string, FontInspection | Error>();
  readonly subsetCalls: SubsetRequest[] = [];
  terminated = 0;
  trimmed = 0;
  gate: Promise<void> = Promise.resolve();

  inspect(file: File): Promise<FontInspection> {
    const result = this.inspections.get(file.name) ?? new Error('未知测试字体');
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  }

  openSession(
    _file: File,
    _key: string,
    threads: number,
    signal: AbortSignal,
  ): Promise<SubsetSession> {
    const session: SubsetSession = {
      threads: Math.min(threads, 3),
      subset: async (request) => {
        this.subsetCalls.push(request);
        await this.gate;
        signal.throwIfAborted();
        const bytes = new Uint8Array(8 + request.codePoints.length);
        bytes.set([0x77, 0x4f, 0x46, 0x32]);
        new DataView(bytes.buffer).setUint32(4, request.codePoints[0] ?? 0);
        return {
          data: bytes.buffer,
          sfntBytes: bytes.byteLength * 2,
          woff2Bytes: bytes.byteLength,
        };
      },
      close: () => Promise.resolve(),
    };
    return Promise.resolve(session);
  }

  trim(): void {
    this.trimmed += 1;
  }

  terminate(): void {
    this.terminated += 1;
  }
}

function fontFile(name: string, signature = '\u0000\u0001\u0000\u0000'): File {
  const header = Uint8Array.from(Array.from(signature).map((character) => character.charCodeAt(0)));
  return new File([header, new Uint8Array(64)], name, { lastModified: 1 });
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup(): { controller: AppController; store: Store<AppState>; engine: FakeEngine } {
  const store = createStore(initialState());
  const engine = new FakeEngine();
  engine.inspections.set('Demo-Regular.ttf', fakeInspection({ coverage: [...ascii, ...han] }));
  engine.inspections.set(
    'Demo-Bold.ttf',
    fakeInspection({
      coverage: [...ascii, ...han],
      weight: 700,
      subfamily: 'Bold',
      fileName: 'Demo-Bold.ttf',
    }),
  );
  engine.inspections.set('Latin.ttf', fakeInspection({ coverage: ascii, fileName: 'Latin.ttf' }));
  const controller = new AppController({
    store,
    engine,
    repository,
    device: { hardwareConcurrency: 8, deviceMemory: 8 },
    validateShard: () => Promise.resolve(),
    appVersion: 'test',
  });
  cleanup = controller.start();
  return { controller, store, engine };
}

async function ready(store: Store<AppState>): Promise<void> {
  await vi.waitFor(() => {
    const state = store.get();
    expect(selectBlockers(state)).toEqual([]);
    expect(selectExportPlan(state)?.issues).toEqual([]);
  });
}

describe('AppController', () => {
  it('按签名接收字体、拒绝伪装文件并自动分析', async () => {
    const { controller, store } = setup();
    await controller.addFiles([
      fontFile('Demo-Regular.ttf'),
      fontFile('notes.ttf', 'PK\u0003\u0004'),
    ]);
    expect(store.get().rejected).toEqual([
      expect.objectContaining({ name: 'notes.ttf', code: 'unknown-font-signature' }),
    ]);
    await vi.waitFor(() => {
      expect(store.get().fonts[0]?.status).toBe('ready');
    });
    expect(store.get().fonts[0]?.draft?.family).toBe('Demo Sans');
    await controller.addFiles([fontFile('Demo-Regular.ttf')]);
    expect(store.get().fonts).toHaveLength(1);
  });

  it('清理后再次 start()（React StrictMode 开发模式）仍能接收并分析字体', async () => {
    const { controller, store } = setup();
    cleanup?.();
    cleanup = controller.start();
    await controller.addFiles([fontFile('Demo-Regular.ttf')]);
    expect(store.get().fonts).toHaveLength(1);
    await vi.waitFor(() => {
      expect(store.get().fonts[0]?.status).toBe('ready');
    });
  });

  it('生成全部分片并产出可打包的结果；设置改变后结果过期', async () => {
    const { controller, store, engine } = setup();
    await controller.addFiles([fontFile('Demo-Regular.ttf'), fontFile('Demo-Bold.ttf')]);
    await ready(store);
    const plan = selectExportPlan(store.get());
    expect(plan?.outputs).toHaveLength(2);

    await controller.generate();
    const state = store.get();
    expect(state.run.phase).toBe('done');
    const result = state.run.result;
    expect(result?.shardData.size).toBe(plan?.totalShardCount);
    expect(engine.subsetCalls).toHaveLength(plan?.totalShardCount ?? -1);
    expect(
      [...(result?.shardData.keys() ?? [])].every((name) => /\.[0-9a-f]{8}\.woff2$/u.test(name)),
    ).toBe(true);
    expect(result?.inputKey).toBe(selectInputKey(state));
    expect(result?.context.threads).toBe(3);

    const pack = controller.resultPackage(
      result ??
        (() => {
          throw new Error('no result');
        })(),
      'zh-CN',
    );
    expect(pack.files.get('fonts.css')).toContain('@font-face');
    expect([...pack.files.keys()].filter((name) => name.startsWith('fonts/'))).toHaveLength(
      plan?.totalShardCount ?? -1,
    );

    controller.updatePlan({ granularity: 1 });
    expect(selectInputKey(store.get())).not.toBe(result.inputKey);
    expect(store.get().run.result).toBe(result);
  });

  it('取消生成会终止线程、保留设置，并阻止迟到结果写回', async () => {
    const { controller, store, engine } = setup();
    await controller.addFiles([fontFile('Demo-Regular.ttf')]);
    await ready(store);
    let release: () => void = () => undefined;
    engine.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = controller.generate();
    await vi.waitFor(() => {
      expect(store.get().run.phase).toBe('running');
    });
    controller.cancelRun();
    release();
    await running;
    expect(store.get().run.phase).toBe('cancelled');
    expect(store.get().run.result).toBeNull();
    expect(engine.terminated).toBeGreaterThan(0);
    expect(store.get().characters.level).toBe('common');
  });

  it('分析失败的字体阻止生成，可重试或移除', async () => {
    const { controller, store, engine } = setup();
    engine.inspections.set('Broken.ttf', new Error('无法识别字体格式或文件已损坏'));
    await controller.addFiles([fontFile('Demo-Regular.ttf'), fontFile('Broken.ttf')]);
    await vi.waitFor(() => {
      expect(store.get().fonts.find((font) => font.file.name === 'Broken.ttf')?.status).toBe(
        'error',
      );
    });
    expect(selectBlockers(store.get())).toContainEqual(
      expect.objectContaining({ code: 'font-error', name: 'Broken.ttf' }),
    );
    expect(controller.canGenerate()).toBe(false);

    engine.inspections.set(
      'Broken.ttf',
      fakeInspection({ coverage: [...ascii, ...han], weight: 700, fileName: 'Broken.ttf' }),
    );
    const broken = store.get().fonts.find((font) => font.file.name === 'Broken.ttf');
    controller.retryFont(broken?.id ?? '');
    await ready(store);
    expect(controller.canGenerate()).toBe(true);

    controller.removeFont(broken?.id ?? '');
    expect(store.get().fonts).toHaveLength(1);
  });

  it('几乎不含汉字的字体默认改为全部字符，用户改动后不再干预', async () => {
    const { controller, store } = setup();
    await controller.addFiles([fontFile('Latin.ttf')]);
    await vi.waitFor(() => {
      expect(store.get().characters.level).toBe('all');
    });
    controller.updateCharacters((settings) => ({ ...settings, level: 'text' }));
    expect(store.get().charactersTouched).toBe(true);
  });

  it('同名字族一起改名，重复坐标会成为规划问题', async () => {
    const { controller, store } = setup();
    await controller.addFiles([fontFile('Demo-Regular.ttf'), fontFile('Demo-Bold.ttf')]);
    await ready(store);
    controller.renameFamily('Demo Sans', 'Site Sans');
    expect(store.get().fonts.every((font) => font.draft?.family === 'Site Sans')).toBe(true);
    const bold = store.get().fonts[1];
    controller.updateDraft(bold?.id ?? '', { weight: 400 });
    expect(selectExportPlan(store.get())?.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-face' }),
    );
  });
});
