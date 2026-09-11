import {
  escapeHtml,
  fontFamilyValue,
  generateFontFaceCss,
  generatePreloadHtml,
  formatFontNumericDescriptor,
  type CssFace,
} from './css-gen';
import type { ExportOutput, OutputSettings } from './export-plan';
import type { FontScript } from './font-script';
import type { TextProfile } from './frequency';
import { formatBytes } from './font-file';
import { evaluateShards, type PlanMetrics } from './plan-metrics';
import { compressRanges, formatCodePoint, formatUnicodeRanges } from './range-codec';
import { shardLoadProbability, type PlanSettings, type ShardKind } from './shard-planner';
import { PAGE_PROFILES } from './plan-metrics';
import { REPOSITORY_URL } from './project';

export type OutputLocale = 'zh-CN' | 'en';

export interface GeneratedShard {
  readonly key: string;
  readonly kind: ShardKind;
  readonly fileName: string;
  readonly codePoints: readonly number[];
  readonly bytes: number;
  readonly sfntBytes: number;
  readonly estimatedBytes: number;
  readonly mass: number;
  readonly preload: boolean;
}

export interface GeneratedOutput extends Omit<
  ExportOutput,
  'shards' | 'metrics' | 'costs' | 'available' | 'missing'
> {
  readonly availableCount: number;
  readonly missing: readonly number[];
  readonly shards: readonly GeneratedShard[];
  readonly metrics: PlanMetrics;
}

export interface PackageContext {
  readonly outputs: readonly GeneratedOutput[];
  readonly settings: OutputSettings;
  readonly urlPrefix: string;
  readonly plan: PlanSettings;
  readonly characters: {
    readonly presetIds: readonly string[];
    readonly requestedCount: number;
    readonly customCount: number;
    readonly allFontCharacters: boolean;
    readonly textProfile: TextProfile;
    /** 首个字体的文字类型：西文字体按区块取字体自身字符，预览文本也不同。 */
    readonly script: FontScript;
  };
  readonly generatedAt: string;
  readonly locale: OutputLocale;
  readonly elapsedMs: number;
  readonly threads: number;
  readonly totalSourceBytes: number;
  readonly appVersion: string;
}

export interface PackageTexts {
  readonly css: string;
  readonly preloadHtml: string;
  readonly usageCss: string;
  readonly reportJson: string;
  readonly demoHtml: string;
  readonly readme: string;
  readonly zipName: string;
}

export function withMeasuredMetrics(output: Omit<GeneratedOutput, 'metrics'>): GeneratedOutput {
  return {
    ...output,
    metrics: evaluateShards(
      output.shards.map((shard) => ({ kind: shard.kind, mass: shard.mass, bytes: shard.bytes })),
    ),
  };
}

export function cssFaces(outputs: readonly GeneratedOutput[]): CssFace[] {
  return outputs.map((output) => ({
    family: output.family,
    weight: output.weight,
    ...(output.stretch === undefined ? {} : { stretch: output.stretch }),
    style: output.style,
    shards: output.shards.map((shard) => ({
      fileName: shard.fileName,
      codePoints: shard.codePoints,
      preload: shard.preload,
    })),
  }));
}

/** 第一个正文字族用于 body、第一个等宽字族用于代码元素，其余给出类名。 */
function usageSnippet(outputs: readonly GeneratedOutput[]): string {
  const families = [...new Map(outputs.map((output) => [output.family, output])).values()];
  let body = false;
  let code = false;
  return families
    .map((output) => {
      let selector = `.font-${output.filePrefix}`;
      if (output.monospace && !code) {
        selector = 'code, kbd, samp, pre';
        code = true;
      } else if (!output.monospace && !body) {
        selector = 'body';
        body = true;
      }
      return `${selector} {\n  font-family: ${fontFamilyValue(output.family)};\n}`;
    })
    .join('\n\n');
}

function probabilities(shard: GeneratedShard): Record<string, number> {
  return Object.fromEntries(
    PAGE_PROFILES.map((profile) => [
      profile.id,
      Number(shardLoadProbability(shard, profile.tokens).toFixed(4)),
    ]),
  );
}

function reportObject(context: PackageContext) {
  const totalBytes = context.outputs.reduce(
    (total, output) => total + output.metrics.totalBytes,
    0,
  );
  return {
    schema: 'webfont-slice/report@4',
    generator: `WebFont Slice ${context.appVersion}`,
    homepage: REPOSITORY_URL,
    generatedAt: context.generatedAt,
    privacy: 'Generated entirely in the local browser; fonts and text were never uploaded.',
    characters: context.characters,
    plan: context.plan,
    output: context.settings,
    summary: {
      sourceBytes: context.totalSourceBytes,
      outputBytes: totalBytes,
      faces: context.outputs.length,
      shards: context.outputs.reduce((total, output) => total + output.shards.length, 0),
      elapsedMs: Math.round(context.elapsedMs),
      threads: context.threads,
    },
    faces: context.outputs.map((output) => ({
      family: output.family,
      weight: output.weight,
      stretch: output.stretch ?? null,
      style: output.style,
      monospace: output.monospace,
      instance: output.instanceName,
      variation: {
        mode: output.variationMode,
        coordinates: output.variationCoordinates ?? null,
      },
      source: { fileName: output.sourceFileName, bytes: output.sourceSize },
      availableCount: output.availableCount,
      missingCount: output.missing.length,
      missing: output.missing.map(formatCodePoint),
      metrics: output.metrics,
      singleFileEstimateBytes: output.singleFileBytes,
      shards: output.shards.map((shard) => ({
        file: shard.fileName,
        key: shard.key,
        kind: shard.kind,
        characters: shard.codePoints.length,
        bytes: shard.bytes,
        estimatedBytes: shard.estimatedBytes,
        preload: shard.preload,
        loadProbability: probabilities(shard),
        unicodeRange: formatUnicodeRanges(compressRanges(shard.codePoints)),
      })),
    })),
  };
}

function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003c')
    .replace(/>/gu, '\\u003e')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

const DEMO_TEXT_ZH =
  '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。\n网页只会下载这段文字实际用到的分片：试着输入新的句子，右侧列表会实时显示新加载的文件。\nThe quick brown fox jumps over the lazy dog. 0123456789';
const DEMO_TEXT_EN =
  '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。\nOnly the shards used by this text are downloaded. Type something new and watch the list update.\nThe quick brown fox jumps over the lazy dog. 0123456789';
const DEMO_TEXT_WESTERN =
  'The quick brown fox jumps over the lazy dog. 0123456789\nOnly the shards used by this text are downloaded. Try Ελληνικά, кириллица or Tiếng Việt and watch the list update.';

/** 等宽字体的预览：连字、易混字符、制表符与箭头，各自落在不同分片。 */
export const CODE_SAMPLE = [
  'const shards = fonts.filter((f) => f.size >= 0x1F && f.ok !== false);',
  'if (a <= b && c != d) return x => y ?? z; // 0O 1lI |',
  '┌──────────┬─────┐  ← → ↑ ↓  ✓ ✗  λ π Σ',
  '│ unicode  │ OK  │  «» “” — …  €£¥',
  '└──────────┴─────┘',
].join('\n');

/** 结果预览与 demo.html 的默认文字：等宽字体用代码，西文字体用多语言样例。 */
export function defaultPreviewText(
  script: FontScript,
  monospace: boolean,
  locale: OutputLocale,
): string {
  if (monospace) return CODE_SAMPLE;
  if (script === 'western') return DEMO_TEXT_WESTERN;
  return locale === 'en' ? DEMO_TEXT_EN : DEMO_TEXT_ZH;
}

function createDemoHtml(context: PackageContext, preloadHtml: string): string {
  const english = context.locale === 'en';
  const monospace = context.outputs[0]?.monospace ?? false;
  const manifest = Object.fromEntries(
    context.outputs.flatMap((output) =>
      output.shards.map((shard) => [
        shard.fileName,
        { bytes: shard.bytes, chars: shard.codePoints.length, key: shard.key },
      ]),
    ),
  );
  const faces = context.outputs.map((output) => ({
    label: `${output.family} · ${formatFontNumericDescriptor(output.weight)}${output.style === 'normal' ? '' : ` ${output.style}`}`,
    stack: fontFamilyValue(output.family),
    weight: typeof output.weight === 'number' ? output.weight : 400,
    style: output.style,
  }));
  const title = english ? 'WebFont Slice · shard preview' : 'WebFont Slice · 分片预览';
  return `<!doctype html>
<html lang="${context.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${preloadHtml}
<link rel="stylesheet" href="./fonts.css">
<style>
:root{color-scheme:light dark;--bg:#f7f7f5;--fg:#18181b;--muted:#71717a;--line:#e4e4e7;--card:#fff;--accent:#e5484d}
@media (prefers-color-scheme:dark){:root{--bg:#0c0c0d;--fg:#ededef;--muted:#a1a1aa;--line:#27272a;--card:#151517;--accent:#ff6a5b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1120px;margin:0 auto;padding:40px 24px;display:grid;gap:20px;grid-template-columns:minmax(0,1fr) 300px}
header{grid-column:1/-1}h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:var(--muted)}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px}
.editor{min-height:340px;font-size:40px;line-height:1.5;outline:none;white-space:pre-wrap;word-break:break-word}
.editor.code{font-size:18px;white-space:pre;overflow-x:auto}
select,input{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px;color:var(--muted)}
ol{list-style:none;margin:0;padding:0;display:grid;gap:6px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
li{display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-radius:6px;background:color-mix(in srgb,var(--accent) 10%,transparent)}
.total{font-size:28px;font-weight:600;font-variant-numeric:tabular-nums}.muted{color:var(--muted)}
.warn{display:none;padding:12px 16px;border-radius:10px;background:color-mix(in srgb,var(--accent) 14%,transparent);grid-column:1/-1}
@media (max-width:800px){main{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(english ? 'Files are requested only when the text below needs them.' : '只有下方文字真正用到的分片才会被请求。')}</p></header>
<div class="warn" id="file-warning">${escapeHtml(english ? 'Browsers block fonts on file:// pages. Serve this folder over HTTP, e.g. `npx serve .`' : '浏览器不允许 file:// 页面加载字体，请用本地服务器打开此目录，例如 `npx serve .`')}</div>
<section class="card">
<div class="toolbar"><select id="face" aria-label="${escapeHtml(english ? 'Font face' : '字体款式')}"></select><label>${escapeHtml(english ? 'Size' : '字号')} <input id="size" type="range" min="12" max="96" value="${monospace ? '18' : '40'}"></label></div>
<div class="editor${monospace ? ' code' : ''}" id="editor" contenteditable="true" spellcheck="false"></div>
</section>
<aside class="card">
<div class="muted">${escapeHtml(english ? 'Downloaded' : '已下载')}</div>
<div class="total" id="total">0 KB</div>
<div class="muted" id="count"></div>
<ol id="files" style="margin-top:14px"></ol>
</aside>
</main>
<script type="application/json" id="manifest">${scriptJson(manifest)}</script>
<script type="application/json" id="faces">${scriptJson(faces)}</script>
<script>
(() => {
  const manifest = JSON.parse(document.getElementById('manifest').textContent);
  const faces = JSON.parse(document.getElementById('faces').textContent);
  const editor = document.getElementById('editor');
  const select = document.getElementById('face');
  const seen = new Map();
  editor.textContent = ${scriptJson(defaultPreviewText(context.characters.script, monospace, context.locale))};
  faces.forEach((face, index) => { const option = new Option(face.label, String(index)); select.add(option); });
  const apply = () => { const face = faces[Number(select.value)] || faces[0]; editor.style.fontFamily = face.stack; editor.style.fontWeight = String(face.weight); editor.style.fontStyle = face.style; };
  select.addEventListener('change', apply); apply();
  document.getElementById('size').addEventListener('input', (event) => { editor.style.fontSize = event.target.value + 'px'; });
  if (location.protocol === 'file:') document.getElementById('file-warning').style.display = 'block';
  const render = () => {
    const list = document.getElementById('files'); list.textContent = '';
    let total = 0;
    for (const [name, info] of seen) { total += info.bytes; const item = document.createElement('li'); item.innerHTML = '<span></span><span></span>'; item.children[0].textContent = info.key + ' · ' + info.chars; item.children[1].textContent = (info.bytes / 1024).toFixed(1) + ' KB'; item.title = name; list.append(item); }
    document.getElementById('total').textContent = (total / 1024).toFixed(1) + ' KB';
    document.getElementById('count').textContent = seen.size + ' / ' + Object.keys(manifest).length + ${scriptJson(english ? ' files' : ' 个文件')};
  };
  const record = (entry) => { const name = decodeURIComponent(entry.name.split('/').pop().split('?')[0]); const info = manifest[name]; if (info && !seen.has(name)) { seen.set(name, info); render(); } };
  performance.getEntriesByType('resource').forEach(record);
  new PerformanceObserver((list) => list.getEntries().forEach(record)).observe({ type: 'resource', buffered: true });
  render();
})();
</script>
</body>
</html>
`;
}

function createReadme(context: PackageContext, texts: { usage: string; preload: string }): string {
  const english = context.locale === 'en';
  const shardCount = context.outputs.reduce((total, output) => total + output.shards.length, 0);
  const totalBytes = context.outputs.reduce(
    (total, output) => total + output.metrics.totalBytes,
    0,
  );
  const families = [...new Set(context.outputs.map((output) => output.family))].join(', ');
  const primary = context.outputs[0];
  const article = primary?.metrics.profiles.find((profile) => profile.id === 'article');
  if (english) {
    return `# ${families} · web font package

Generated locally by [WebFont Slice](${REPOSITORY_URL}) ${context.appVersion} on ${context.generatedAt}.
${String(context.outputs.length)} face(s), ${String(shardCount)} WOFF2 shards, ${formatBytes(totalBytes)} in total${article === undefined ? '' : `; a typical article page downloads about ${article.expectedRequests.toFixed(1)} files / ${formatBytes(article.expectedBytes)}`}.

## Deploy

1. Upload \`fonts.css\` and the \`fonts/\` folder to your site${context.urlPrefix ? ` (font files are referenced from \`${context.urlPrefix}/\`)` : ''}.
2. Add to \`<head>\`:

\`\`\`html
${texts.preload}
<link rel="stylesheet" href="/path/to/fonts.css">
\`\`\`

3. Use the family:

\`\`\`css
${texts.usage}
\`\`\`

The CSS declares only this font. Append your own fallback stack to \`font-family\` if you want one.

## Caching

File names contain a content hash, so they can be cached forever:

\`\`\`
Cache-Control: public, max-age=31536000, immutable
\`\`\`

## Files

- \`fonts.css\` — @font-face rules with unicode-range
- \`fonts/*.woff2\` — shards
- \`preload.html\` — preload tags for the shards nearly every page needs
- \`demo.html\` — serve this folder over HTTP to watch shards load on demand
- \`report.json\` — per-shard characters, sizes and load probabilities

Check that the font license allows web embedding before deploying.
`;
  }
  return `# ${families} · 网页字体分包

由 [WebFont Slice](${REPOSITORY_URL}) ${context.appVersion} 于 ${context.generatedAt} 在本地浏览器生成。
共 ${String(context.outputs.length)} 个款式、${String(shardCount)} 个 WOFF2 分片，合计 ${formatBytes(totalBytes)}${article === undefined ? '' : `；典型文章页约下载 ${article.expectedRequests.toFixed(1)} 个文件 / ${formatBytes(article.expectedBytes)}`}。

## 部署

1. 把 \`fonts.css\` 与 \`fonts/\` 目录上传到网站${context.urlPrefix ? `（字体文件引用自 \`${context.urlPrefix}/\`）` : ''}。
2. 在 \`<head>\` 中加入：

\`\`\`html
${texts.preload}
<link rel="stylesheet" href="/path/to/fonts.css">
\`\`\`

3. 使用字体：

\`\`\`css
${texts.usage}
\`\`\`

CSS 只声明本字体；需要回退字体时，在 \`font-family\` 后面追加你自己的字体栈。

## 缓存

文件名带有内容哈希，可以设置长期缓存：

\`\`\`
Cache-Control: public, max-age=31536000, immutable
\`\`\`

## 文件

- \`fonts.css\`：带 unicode-range 的 @font-face
- \`fonts/*.woff2\`：分片
- \`preload.html\`：几乎每页都会用到的分片的预加载标签
- \`demo.html\`：用本地服务器打开此目录，可观察分片按需加载
- \`report.json\`：每个分片的字符、体积与加载概率

部署前请确认字体许可允许网页嵌入。
`;
}

export function buildPackageTexts(context: PackageContext): PackageTexts {
  const faces = cssFaces(context.outputs);
  const css = generateFontFaceCss(faces, {
    urlPrefix: context.urlPrefix,
    fontDisplay: context.settings.fontDisplay,
    generatedAt: context.generatedAt,
  });
  const preloadHtml = generatePreloadHtml(faces, context.urlPrefix);
  const usageCss = usageSnippet(context.outputs);
  const reportJson = `${JSON.stringify(reportObject(context), null, 2)}\n`;
  const demoHtml = createDemoHtml(context, preloadHtml);
  const readme = createReadme(context, { usage: usageCss, preload: preloadHtml });
  const zipName = `${context.outputs[0]?.filePrefix ?? 'webfont'}-webfont.zip`;
  return { css, preloadHtml, usageCss, reportJson, demoHtml, readme, zipName };
}

export interface PackageFileInput {
  readonly texts: PackageTexts;
  readonly shards: readonly { readonly fileName: string; readonly data: Uint8Array }[];
}

/** ZIP 内的路径 → 内容。重复文件名直接拒绝，不能依赖界面预检。 */
export function packageFiles(input: PackageFileInput): Map<string, Uint8Array | string> {
  const files = new Map<string, Uint8Array | string>([
    ['fonts.css', input.texts.css],
    ['preload.html', `${input.texts.preloadHtml}\n`],
    ['demo.html', input.texts.demoHtml],
    ['report.json', input.texts.reportJson],
    ['README.md', input.texts.readme],
  ]);
  for (const shard of input.shards) {
    const path = `fonts/${shard.fileName}`;
    if (files.has(path)) throw new Error(`ZIP 包含重复文件名：${shard.fileName}`);
    files.set(path, shard.data);
  }
  return files;
}
