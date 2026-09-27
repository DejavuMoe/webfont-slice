// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppController } from '../app/controller';
import type { CharsetRepository, FontEngine, SubsetSession } from '../app/ports';
import { initialState } from '../app/state';
import { createStore } from '../app/store';
import type { CharsetPreset } from '../core/charset-store';
import { fakeInspection } from '../core/test-support';
import { PreferencesProvider } from '../i18n/PreferencesProvider';
import { ServicesContext, type AppServices } from './app-context';
import { Shell } from './Shell';

const han = Array.from({ length: 600 }, (_, index) => 0x4e00 + index);
const ascii = Array.from({ length: 95 }, (_, index) => 0x20 + index);

function preset(id: string, codePoints: readonly number[]): CharsetPreset {
  return {
    id,
    name: `字表 ${id}`,
    category: id.startsWith('tc')
      ? 'traditional'
      : id.startsWith('sc')
        ? 'simplified'
        : 'functional',
    expectedCount: codePoints.length,
    standard: 'test',
    description: 'test',
    source: 'https://example.com/source',
    license: 'test license',
    ranges: [],
    codePoints,
  };
}

const IDS = [
  'sc-tgh-1',
  'sc-tgh-12',
  'sc-tgh-full',
  'sc-gb2312',
  'sc-gbk',
  'sc-gb18030-l1',
  'tc-moe-common',
  'tc-big5-common',
  'tc-hk-common',
  'tc-hkscs',
  'tc-big5-full',
  'f-latin-ascii',
  'f-punct-cn',
  'u-cjk-punct',
  'f-punct-west',
  'f-digits-cjk',
];

const repository: CharsetRepository = {
  loadIndex: () =>
    Promise.resolve({ version: 2, presets: IDS.map((id) => preset(id, han.slice(0, 400))) }),
  loadPreset: (id) =>
    Promise.resolve(
      id.startsWith('f-') || id.startsWith('u-')
        ? preset(id, ascii)
        : preset(id, han.slice(0, id === 'sc-tgh-1' ? 400 : 500)),
    ),
  loadFrequency: () =>
    Promise.resolve({
      version: 2,
      source: 'test',
      sourceUrl: '',
      corpusTotal: 100_000,
      profiles: {
        hans: {
          codePoints: han.slice(0, 300),
          counts: han.slice(0, 300).map((_, index) => 3000 - index * 9),
        },
        hant: { codePoints: [], counts: [] },
      },
    }),
};

const engine: FontEngine = {
  inspect: () => Promise.resolve(fakeInspection({ coverage: [...ascii, ...han] })),
  openSession: () => {
    const session: SubsetSession = {
      threads: 2,
      subset: (request) => {
        const bytes = new Uint8Array(16 + request.codePoints.length);
        bytes.set([0x77, 0x4f, 0x46, 0x32]);
        bytes[5] = request.codePoints.length % 251;
        bytes[6] = (request.codePoints[0] ?? 0) % 251;
        return Promise.resolve({
          data: bytes.buffer,
          sfntBytes: bytes.length * 2,
          woff2Bytes: bytes.length,
        });
      },
      close: () => Promise.resolve(),
    };
    return Promise.resolve(session);
  },
  trim: () => undefined,
  terminate: () => undefined,
};

function services(): AppServices {
  const controller = new AppController({
    store: createStore(initialState()),
    engine,
    repository,
    device: { hardwareConcurrency: 4 },
    validateShard: () => Promise.resolve(),
    appVersion: 'test',
  });
  return {
    controller,
    platform: {
      createSourcePreview: () => ({
        family: 'sans-serif',
        load: () => Promise.resolve(true),
        dispose: () => undefined,
      }),
      createShardPreview: () => ({
        family: 'sans-serif',
        requestedIds: () => new Set<string>(),
        subscribe: () => () => undefined,
        attach: () => undefined,
        detach: () => undefined,
      }),
      copyText: vi.fn(() => Promise.resolve()),
      downloadBytes: vi.fn(),
      buildZip: vi.fn(() => Promise.resolve(new Uint8Array([0x50, 0x4b]))),
      canWriteDirectory: () => false,
      writeToDirectory: vi.fn(() => Promise.resolve('fonts')),
      readTextFile: () => Promise.resolve(''),
    },
  };
}

function fontFile(name: string): File {
  return new File([new Uint8Array([0, 1, 0, 0]), new Uint8Array(32)], name, { lastModified: 1 });
}

beforeAll(() => {
  localStorage.setItem('webfont-slice:locale', 'zh-CN');
});

afterEach(() => {
  cleanup();
});

function renderShell(value: AppServices) {
  const stop = value.controller.start();
  const view = render(
    <PreferencesProvider>
      <ServicesContext value={value}>
        <Shell
          onApplyUpdate={() => undefined}
          onDismissUpdate={() => undefined}
          showUpdate={false}
          status={{ online: true, offlineReady: true }}
        />
      </ServicesContext>
    </PreferencesProvider>,
  );
  return { ...view, stop };
}

describe('Shell', () => {
  it('从落地页到生成结果的完整流程', async () => {
    const value = services();
    const { stop } = renderShell(value);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('只下载页面');
    expect(screen.getByText('本地处理 · 可离线')).toBeInTheDocument();

    await act(async () => {
      await value.controller.addFiles([fontFile('Demo-Regular.ttf')]);
    });
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'Demo Sans Regular' })).toBeInTheDocument();
    });

    const levels = screen.getByRole('radiogroup', { name: '覆盖范围' });
    fireEvent.click(within(levels).getByText('完整'));
    expect(value.controller.store.get().characters.level).toBe('full');

    const generate = await screen.findByRole('button', { name: /生成 \d+ 个分片/u });
    await waitFor(() => {
      expect(generate).toBeEnabled();
    });
    fireEvent.click(generate);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '结果' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '下载 ZIP' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '下载 ZIP' }));
    await waitFor(() => {
      expect(value.platform.downloadBytes).toHaveBeenCalledWith(
        'demo-sans-webfont.zip',
        expect.any(Uint8Array),
        'application/zip',
      );
    });

    fireEvent.click(screen.getByRole('radio', { name: 'fonts.css' }));
    expect(document.querySelector('pre[aria-label="fonts.css"]')).toHaveTextContent('@font-face');

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '分包方式' })).getByText('单文件'),
    );
    await waitFor(() => {
      expect(
        screen.getByText('设置已更改，这份结果对应上一次生成。在分包预览中按新设置重新生成。'),
      ).toBeInTheDocument();
    });
    stop();
  });

  it('切换语言与主题', async () => {
    const value = services();
    const { stop } = renderShell(value);
    fireEvent.click(screen.getByRole('button', { name: 'Switch to English' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ship only the glyphs');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Theme: system' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: '切换到中文' }));
    stop();
  });
});
