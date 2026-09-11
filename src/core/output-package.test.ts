import { describe, expect, it } from 'vitest';
import type { OutputSettings } from './export-plan';
import {
  buildPackageTexts,
  defaultPreviewText,
  packageFiles,
  withMeasuredMetrics,
  type GeneratedOutput,
  type PackageContext,
} from './output-package';
import { REPOSITORY_URL } from './project';
import { DEFAULT_PLAN_SETTINGS } from './shard-planner';

const settings: OutputSettings = {
  urlPrefix: '',
  fontDisplay: 'swap',
  keepHinting: false,
  cjkFeatures: true,
  trimMetadata: true,
};

function output(family: string, monospace = false): GeneratedOutput {
  return withMeasuredMetrics({
    id: 'font-1:static',
    sourceId: 'font-1',
    sourceFileName: 'Demo.ttf',
    sourceSize: 4_000_000,
    variantId: 'static',
    instanceName: 'Regular',
    family,
    filePrefix: monospace ? 'demo-mono' : 'demo-sans',
    postScriptName: 'DemoSans-Regular',
    weight: 400,
    style: 'normal',
    variationMode: 'none',
    monospace,
    singleFileBytes: 10_500,
    availableCount: 5,
    missing: [0x9fa5],
    shards: [
      {
        key: 'base',
        kind: 'base',
        fileName: 'demo-sans-400-base.aaaa1111.woff2',
        codePoints: [0x41, 0x42],
        bytes: 2000,
        sfntBytes: 5000,
        estimatedBytes: 2100,
        mass: 0,
        preload: true,
      },
      {
        key: '01',
        kind: 'ranked',
        fileName: 'demo-sans-400-01.bbbb2222.woff2',
        codePoints: [0x4e00, 0x4e01, 0x4e02],
        bytes: 9000,
        sfntBytes: 20000,
        estimatedBytes: 8800,
        mass: 0.2,
        preload: true,
      },
    ],
  });
}

function context(
  family = 'Demo Sans',
  locale: 'zh-CN' | 'en' = 'zh-CN',
  outputs: readonly GeneratedOutput[] = [output(family)],
): PackageContext {
  return {
    outputs,
    settings,
    urlPrefix: '',
    plan: DEFAULT_PLAN_SETTINGS,
    characters: {
      presetIds: ['sc-tgh-1'],
      requestedCount: 6,
      customCount: 0,
      allFontCharacters: false,
      textProfile: 'hans',
      script: outputs.every((item) => item.monospace) ? 'western' : 'cjk',
    },
    generatedAt: '2026-09-26T00:00:00.000Z',
    locale,
    elapsedMs: 1234,
    threads: 4,
    totalSourceBytes: 4_000_000,
    appVersion: '2.0.0',
  };
}

describe('输出包', () => {
  it('生成 CSS、预加载、报告、演示页与 README', () => {
    const texts = buildPackageTexts(context());
    expect(texts.css.match(/@font-face/gu)).toHaveLength(2);
    expect(texts.preloadHtml.split('\n')).toHaveLength(2);
    expect(texts.usageCss).toBe('body {\n  font-family: "Demo Sans";\n}');
    expect(texts.css).not.toMatch(/local\(|override|Fallback/u);
    expect(texts.zipName).toBe('demo-sans-webfont.zip');
    const report = JSON.parse(texts.reportJson) as {
      schema: string;
      faces: { shards: unknown[]; missing: string[] }[];
      summary: { shards: number };
    };
    expect(report.schema).toBe('webfont-slice/report@4');
    expect(report.summary.shards).toBe(2);
    expect(report.faces[0]?.missing).toEqual(['U+9FA5']);
    expect(texts.readme).toContain('Cache-Control: public, max-age=31536000, immutable');
    expect(texts.readme).toContain(`[WebFont Slice](${REPOSITORY_URL})`);
    expect(buildPackageTexts(context('Demo Sans', 'en')).readme).toContain('## Deploy');
  });

  it('等宽字体：用法示例指向代码元素，演示页默认显示代码', () => {
    const mono = buildPackageTexts(context('Demo Mono', 'en', [output('Demo Mono', true)]));
    expect(mono.usageCss).toBe('code, kbd, samp, pre {\n  font-family: "Demo Mono";\n}');
    expect(mono.demoHtml).toContain('class="editor code"');
    expect(mono.demoHtml).toContain('0O 1lI');
    expect(JSON.parse(mono.reportJson)).toMatchObject({
      characters: { script: 'western' },
      faces: [{ monospace: true }],
    });

    const mixed = buildPackageTexts(
      context('Demo Sans', 'zh-CN', [output('Demo Sans'), output('Demo Mono', true)]),
    );
    expect(mixed.usageCss).toBe(
      'body {\n  font-family: "Demo Sans";\n}\n\ncode, kbd, samp, pre {\n  font-family: "Demo Mono";\n}',
    );
    expect(defaultPreviewText('western', false, 'zh-CN')).toContain('The quick brown fox');
    expect(defaultPreviewText('cjk', false, 'zh-CN')).toContain('天地玄黄');
  });

  it('演示页对恶意字族名做上下文转义', () => {
    const texts = buildPackageTexts(context('</script><script>alert(1)</script>'));
    expect(texts.demoHtml).not.toContain('<script>alert(1)</script>');
    expect(texts.demoHtml.match(/<script>/gu)?.length).toBe(1);
  });

  it('按实测体积重新计算指标', () => {
    const measured = output('Demo Sans');
    expect(measured.metrics.totalBytes).toBe(11000);
    expect(measured.metrics.shardCount).toBe(2);
  });

  it('ZIP 文件清单拒绝重复文件名', () => {
    const texts = buildPackageTexts(context());
    const files = packageFiles({
      texts,
      shards: [{ fileName: 'a.woff2', data: new Uint8Array([1]) }],
    });
    expect([...files.keys()]).toEqual([
      'fonts.css',
      'preload.html',
      'demo.html',
      'report.json',
      'README.md',
      'fonts/a.woff2',
    ]);
    expect(() =>
      packageFiles({
        texts,
        shards: [
          { fileName: 'a.woff2', data: new Uint8Array([1]) },
          { fileName: 'a.woff2', data: new Uint8Array([2]) },
        ],
      }),
    ).toThrow('重复');
  });
});
