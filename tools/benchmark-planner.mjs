/**
 * 分包规划基准：用一款真实字体、内置字表和字频数据，比较不同分包方案的
 * 每页期望下载量与请求数。规划与估算直接复用 src/core 与 src/engine 的实现
 * （经 Vite SSR 加载 TypeScript），数字与界面中显示的完全一致。
 *
 *   pnpm benchmark:planner [font.ttf|otf|woff2] [--scenario sc-common,sc-full,font-all] [--measure] [--json]
 *
 * 场景：<语言>-<档位>（sc / tc-tw / tc-hk × common / full）、font-all（字体全部字符），
 * western-common / western-full（西文字体的"西欧""多语言"档，按区块取字体自身字符），
 * 或任意字表 ID（如 sc-gbk、sc-gb18030-l1，自动附带拉丁与标点基础字表）。
 * 不指定场景时，西文字体默认跑 western-common,western-full,font-all。
 *
 * --measure 会把默认方案的每一片真实子集化并编码为 WOFF2，报告估算误差，
 * 并用实测大小重新计算每页下载量。默认测试字体只有几百个汉字，仅用于冒烟；
 * 请传入一款完整的 CJK 字体获得有意义的结果。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import wawoff2 from 'wawoff2';

const NL = String.fromCharCode(10);
const DEFAULT_FONT = 'src/test/fixtures/noto-sans-sc-subset/NotoSansSC-TestSubset.ttf';
const DEFAULT_SCENARIOS = 'sc-common,sc-full,sc-gb18030-l1,tc-tw-common,font-all';
const WESTERN_SCENARIOS = 'western-common,western-full,font-all';
const LANGUAGE_ALIAS = { sc: 'hans', 'tc-tw': 'hant-tw', 'tc-hk': 'hant-hk' };

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    scenario: { type: 'string' },
    measure: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});
const fontPath = path.resolve(positionals[0] ?? DEFAULT_FONT);

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  // opentype.js 在 Node 下解析为 CommonJS；交给 Vite 转换以使用其 ES 模块入口。
  ssr: { noExternal: ['opentype.js'] },
});

try {
  await run();
} finally {
  await server.close();
}

async function run() {
  const load = (file) => server.ssrLoadModule(file);
  const [
    planner,
    metrics,
    frequencyModule,
    charsets,
    settingsModule,
    exportPlan,
    codepoints,
    script,
  ] = await Promise.all([
    load('/src/core/shard-planner.ts'),
    load('/src/core/plan-metrics.ts'),
    load('/src/core/frequency.ts'),
    load('/src/core/charset-store.ts'),
    load('/src/core/character-settings.ts'),
    load('/src/core/export-plan.ts'),
    load('/src/core/codepoints.ts'),
    load('/src/core/font-script.ts'),
  ]);
  const [fontFormat, inspector, harfbuzz, calibration] = await Promise.all([
    load('/src/core/font-format.ts'),
    load('/src/engine/font-inspector.ts'),
    load('/src/engine/harfbuzz-subset.ts'),
    load('/src/engine/calibration.ts'),
  ]);

  const source = await readFile(fontPath);
  const format = fontFormat.detectFontFormat(source);
  let data;
  if (format === 'ttf' || format === 'otf') data = toArrayBuffer(source);
  else if (format === 'woff2') data = toArrayBuffer(await wawoff2.decompress(source));
  else throw new Error(`不支持的输入格式 ${format}：请提供 TTF、OTF 或 WOFF2`);

  const wasm = await readFile('node_modules/hb-subset-wasm/dist/hb-subset.wasm');
  const subsetter = await harfbuzz.HarfBuzzSubsetter.create(toArrayBuffer(wasm));
  subsetter.loadFont(data);
  const subsetOptions = { keepHinting: false, webFeatures: true, trimMetadata: true };
  const measure = async (codePoints) =>
    (await wawoff2.compress(await subsetter.subset(codePoints, subsetOptions))).byteLength;

  const inspectedAt = performance.now();
  const { inspection: raw } = inspector.inspectFont({
    fileName: path.basename(fontPath),
    format,
    sourceSize: source.byteLength,
    normalizedData: data,
  });
  const inspection = await calibration.calibrateGlyphCosts(raw, measure);
  const inspectMs = performance.now() - inspectedAt;
  const costs = exportPlan.createCostModel(inspection, inspection.variable);

  const frequency = frequencyModule.parseFrequencyData(
    JSON.parse(await readFile('public/freq/han-freq.json', 'utf8')),
  );
  const presetCache = new Map();
  const preset = async (id) => {
    if (!presetCache.has(id)) {
      const json = JSON.parse(await readFile(`public/charsets/${id}.json`, 'utf8'));
      presetCache.set(id, charsets.parseCharsetPreset(json).codePoints);
    }
    return presetCache.get(id);
  };

  const fontScript = script.classifyFontScript(inspection.coverage);
  const report = {
    font: {
      file: path.basename(fontPath),
      family: inspection.family,
      subfamily: inspection.subfamily,
      script: fontScript,
      monospace: inspection.monospace,
      glyphs: inspection.glyphCount,
      characters: inspection.coverage.length,
      normalizedBytes: inspection.normalizedSize,
      variable: inspection.variable,
      calibrated: inspection.glyphCosts.calibrated,
      ratio: round(inspection.glyphCosts.ratio, 4),
      runScale: round(inspection.glyphCosts.runScale ?? 1, 3),
      baseScale: round(inspection.glyphCosts.baseScale ?? 1, 3),
      overhead: Math.round(inspection.glyphCosts.overhead),
      inspectMs: Math.round(inspectMs),
    },
    scenarios: [],
  };

  const scenarios =
    values.scenario ?? (fontScript === 'western' ? WESTERN_SCENARIOS : DEFAULT_SCENARIOS);
  for (const id of scenarios.split(',').map((value) => value.trim())) {
    let presetIds = [];
    let profile = 'hans';
    const level = id.match(/^(sc|tc-tw|tc-hk)-(common|full)$/u);
    const western = id.match(/^western-(common|full)$/u);
    if (level) {
      const language = LANGUAGE_ALIAS[level[1]];
      presetIds = settingsModule.levelPresetIds(language, level[2]);
      profile = settingsModule.profileOf(language);
    } else if (id !== 'font-all' && !western) {
      presetIds = [id, ...settingsModule.BASE_PRESET_IDS];
      profile = id.startsWith('tc-') ? 'hant' : 'hans';
    }
    const target = {
      requested: codepoints.unionSorted(
        await Promise.all(presetIds.map((presetId) => preset(presetId))),
      ),
      allFontCharacters: id === 'font-all',
      fontRanges: western ? script.WESTERN_LEVEL_RANGES[western[1]] : [],
    };
    const available = exportPlan.availableFor(target, inspection.coverage);
    const requested =
      target.fontRanges.length > 0 || target.allFontCharacters ? available : target.requested;
    const usage = frequencyModule.createUsageModel(frequency, profile);

    const plannedAt = performance.now();
    const smart = planner.planShards(available, usage, costs, planner.DEFAULT_PLAN_SETTINGS);
    const planMs = performance.now() - plannedAt;
    const shardCount = smart.shards.length;
    const baseShards = smart.shards.filter((shard) => shard.kind === 'base');

    const rows = [];
    const addRow = (name, shards, extra = {}) =>
      rows.push({ name, ...summarize(metrics.evaluateShards(shards.map(measured))), ...extra });

    addRow('smart · L4（默认）', smart.shards, { planMs: round(planMs, 1) });
    for (let level = 1; level <= planner.GRANULARITY_LEVELS; level += 1) {
      if (level === planner.DEFAULT_PLAN_SETTINGS.granularity) continue;
      const plan = planner.planShards(available, usage, costs, {
        ...planner.DEFAULT_PLAN_SETTINGS,
        granularity: level,
      });
      addRow(`smart · L${String(level)}`, plan.shards);
    }
    const main = available.filter((codePoint) => !planner.isBaseCodePoint(codePoint));
    const byFrequency = [...main].sort(
      (left, right) => usage.probability(right) - usage.probability(left) || left - right,
    );
    const byCount = [
      ...baseShards,
      ...chunkByBytes(byFrequency, Math.max(1, shardCount - baseShards.length), usage, costs),
    ];
    addRow(`字频顺序等大 · ${String(byCount.length)} 片`, byCount);
    const naive = [
      ...baseShards,
      ...chunkByBytes(main, Math.max(1, shardCount - baseShards.length), usage, costs),
    ];
    addRow(`码点顺序等大 · ${String(naive.length)} 片`, naive);
    const single = planner.planShards(available, usage, costs, {
      ...planner.DEFAULT_PLAN_SETTINGS,
      strategy: 'single',
    }).shards;
    addRow('单文件', single);

    const entry = {
      id,
      profile,
      requested: requested.length,
      available: available.length,
      missing: requested.length - available.length,
      corpusCoverage: round(frequencyModule.corpusCoverage(available, frequency, profile), 4),
      rows,
    };

    if (values.measure) {
      const measuredAt = performance.now();
      const byKind = new Map();
      let absoluteError = 0;
      const real = [];
      for (const shard of smart.shards) {
        const bytes = await measure(shard.codePoints);
        const kind = byKind.get(shard.kind) ?? { shards: 0, estimated: 0, actual: 0 };
        kind.shards += 1;
        kind.estimated += shard.estimatedBytes;
        kind.actual += bytes;
        byKind.set(shard.kind, kind);
        absoluteError += Math.abs(shard.estimatedBytes - bytes) / bytes;
        real.push({ kind: shard.kind, mass: shard.mass, bytes });
      }
      const estimated = real.reduce(
        (total, _, index) => total + smart.shards[index].estimatedBytes,
        0,
      );
      const actual = real.reduce((total, shard) => total + shard.bytes, 0);
      entry.measured = {
        ...summarize(metrics.evaluateShards(real)),
        estimateError: round(estimated / actual - 1, 4),
        meanAbsoluteShardError: round(absoluteError / smart.shards.length, 4),
        kinds: Object.fromEntries(
          [...byKind].map(([kind, value]) => [
            kind,
            {
              shards: value.shards,
              actual: value.actual,
              error: round(value.estimated / value.actual - 1, 4),
            },
          ]),
        ),
        subsetMs: Math.round(performance.now() - measuredAt),
      };
      const singleBytes = await measure(single[0].codePoints);
      entry.measured.kinds.single = {
        shards: 1,
        actual: singleBytes,
        error: round(single[0].estimatedBytes / singleBytes - 1, 4),
      };
    }
    report.scenarios.push(entry);
  }

  subsetter.dispose();
  console.log(values.json ? JSON.stringify(report, null, 2) : markdown(report));
}

function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function measured(shard) {
  return { kind: shard.kind, mass: shard.mass, bytes: shard.estimatedBytes ?? shard.bytes };
}

/** 对照组：不看字频，按码点顺序切成估算字节相等的若干片。 */
function chunkByBytes(codePoints, parts, usage, costs) {
  const total = codePoints.reduce((sum, codePoint) => sum + Math.max(1, costs.cost(codePoint)), 0);
  const target = total / parts;
  const shards = [];
  let current = { kind: 'ranked', codePoints: [], estimatedBytes: costs.overhead, mass: 0 };
  let accumulated = 0;
  for (const codePoint of codePoints) {
    const cost = Math.max(1, costs.cost(codePoint));
    current.codePoints.push(codePoint);
    current.estimatedBytes += cost;
    current.mass += usage.probability(codePoint);
    accumulated += cost;
    if (accumulated >= target * (shards.length + 1) && shards.length < parts - 1) {
      shards.push(current);
      current = { kind: 'ranked', codePoints: [], estimatedBytes: costs.overhead, mass: 0 };
    }
  }
  if (current.codePoints.length > 0) shards.push(current);
  return shards;
}

function summarize(result) {
  return {
    shards: result.shardCount,
    totalBytes: Math.round(result.totalBytes),
    pages: Object.fromEntries(
      result.profiles.map((profile) => [
        profile.id,
        {
          tokens: profile.tokens,
          bytes: Math.round(profile.expectedBytes),
          requests: round(profile.expectedRequests, 1),
        },
      ]),
    ),
  };
}

function round(value, digits) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function kb(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`;
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value) {
  return `${value > 0 ? '+' : ''}${percent(value)}`;
}

function markdown(report) {
  const { font } = report;
  const lines = [
    `# 分包规划基准 · ${font.family} ${font.subfamily}`,
    '',
    `- 文件：${font.file}（${kb(font.normalizedBytes)}，${font.glyphs.toLocaleString('en-US')} 字形，` +
      `${font.characters.toLocaleString('en-US')} 个字符${font.variable ? '，可变字体' : ''}）`,
    `- 体积模型：${font.calibrated ? '已实测校准' : '未校准（默认比例）'}，` +
      `WOFF2 ≈ ${kb(font.overhead)} + ${String(font.ratio)} × 原始字形字节，` +
      `连续码点 ×${String(font.runScale)}，基础字符 ×${String(font.baseScale)}；分析用时 ${String(font.inspectMs)} ms`,
    '- 每页数字是期望值：页面正文按字频独立抽样，分片被用到才会下载。',
  ];
  if (font.script === 'western') {
    lines.push(
      `- 西文${font.monospace ? '等宽' : ''}字体：几乎全部字符没有字频依据，按文字分组的码点顺序装箱；每页数字主要反映基础片。`,
    );
  } else if (font.characters < 2000) {
    lines.push('- 注意：这款字体字符很少，结果只能用于冒烟；请传入完整的 CJK 字体。');
  }
  for (const scenario of report.scenarios) {
    const single = scenario.rows.find((row) => row.name === '单文件');
    lines.push(
      '',
      `## ${scenario.id} · ${scenario.profile}`,
      '',
      `可用 ${scenario.available.toLocaleString('en-US')} / 目标 ${scenario.requested.toLocaleString('en-US')} 字，` +
        `语料覆盖 ${percent(scenario.corpusCoverage)}`,
      '',
      '| 方案 | 片数 | 总大小 | 标题页 300 字 | 文章页 1500 字 | 长文 6000 字 | 文章页较单文件 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const row of scenario.rows) {
      const cells = ['headline', 'article', 'longform'].map(
        (id) => `${kb(row.pages[id].bytes)} · ${String(row.pages[id].requests)} 次`,
      );
      const saving =
        single === undefined
          ? ''
          : signed(row.pages.article.bytes / single.pages.article.bytes - 1);
      lines.push(
        `| ${row.name} | ${String(row.shards)} | ${kb(row.totalBytes)} | ${cells.join(' | ')} | ${saving} |`,
      );
    }
    const smart = scenario.rows[0];
    lines.push('', `规划用时 ${String(smart.planMs)} ms`);
    if (scenario.measured !== undefined) {
      const real = scenario.measured;
      lines.push(
        '',
        `实测（默认方案逐片子集化，${String(real.subsetMs)} ms）：总大小 ${kb(real.totalBytes)}，` +
          `估算偏差 ${signed(real.estimateError)}，单片平均绝对偏差 ${percent(real.meanAbsoluteShardError)}；` +
          `文章页 ${kb(real.pages.article.bytes)} · ${String(real.pages.article.requests)} 次`,
        '',
        Object.entries(real.kinds)
          .map(
            ([kind, value]) =>
              `${kind} ${String(value.shards)} 片 ${kb(value.actual)}（估算 ${signed(value.error)}）`,
          )
          .join('；'),
      );
    }
  }
  return lines.join(NL);
}
