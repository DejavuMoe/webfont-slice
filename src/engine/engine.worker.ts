/// <reference lib="webworker" />

import { expose, transfer } from 'comlink';
import harfBuzzSubsetWasmUrl from 'hb-subset-wasm/hb-subset.wasm?url';
import type { FontInspection, InspectionWarning } from '../core/font-inspection';
import { detectFontFormat, type FontFormat } from '../core/font-format';
import { MAX_FONT_FILE_SIZE } from '../core/font-file';
import { calibrateGlyphCosts } from './calibration';
import { LARGE_NORMALIZED_FONT_SIZE, assertNormalizedFontSize } from './font-budget';
import { inspectFont } from './font-inspector';
import { HarfBuzzSubsetter, type SubsetOptions } from './harfbuzz-subset';
import type { EngineWorkerApi, InspectOptions, SubsetRequest, SubsetResult } from './protocol';

let subsetterPromise: Promise<HarfBuzzSubsetter> | undefined;
let openKey: string | null = null;

function getSubsetter(): Promise<HarfBuzzSubsetter> {
  subsetterPromise ??= (async () => {
    const response = await fetch(harfBuzzSubsetWasmUrl);
    if (!response.ok) throw new Error(`无法加载 HarfBuzz WASM（HTTP ${String(response.status)}）`);
    return HarfBuzzSubsetter.create(await response.arrayBuffer());
  })();
  void subsetterPromise.catch(() => {
    subsetterPromise = undefined;
  });
  return subsetterPromise;
}

function owned(data: Uint8Array): ArrayBuffer {
  return data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength &&
    data.buffer instanceof ArrayBuffer
    ? data.buffer
    : Uint8Array.from(data).buffer;
}

interface NormalizedFont {
  readonly format: FontFormat;
  readonly data: ArrayBuffer;
  readonly sourceSize: number;
  readonly warnings: InspectionWarning[];
}

/** 签名判定格式，WOFF/WOFF2 在预算内解包为 SFNT。 */
async function normalize(file: File): Promise<NormalizedFont> {
  if (file.size === 0) throw new Error('字体文件为空');
  if (file.size > MAX_FONT_FILE_SIZE) throw new Error('字体文件超过 100 MB 上限');
  const source = await file.arrayBuffer();
  const format = detectFontFormat(source);
  if (format === 'unknown') throw new Error('无法识别字体格式或文件已损坏');
  if (format === 'ttc') throw new Error('暂不支持 TTC/OTC 字体合集，请先导出单个字体');
  const warnings: InspectionWarning[] = [];
  let data = source;
  if (format === 'woff2') {
    const { decompressWoff2 } = await import('./woff2');
    data = owned(await decompressWoff2(new Uint8Array(source)));
  } else if (format === 'woff') {
    const { normalizeWoff1 } = await import('./woff1');
    data = normalizeWoff1(source);
    warnings.push({ code: 'woff1-normalized' });
  }
  assertNormalizedFontSize(data.byteLength);
  if (data.byteLength > LARGE_NORMALIZED_FONT_SIZE) {
    warnings.push({ code: 'large-font', normalizedSize: data.byteLength });
  }
  return { format, data, sourceSize: source.byteLength, warnings };
}

function subsetOptions(request: SubsetRequest): SubsetOptions {
  return {
    keepHinting: request.keepHinting,
    webFeatures: request.webFeatures,
    trimMetadata: request.trimMetadata,
    ...(request.variationAxes === undefined ? {} : { variationAxes: request.variationAxes }),
  };
}

async function subsetToWoff2(
  subsetter: HarfBuzzSubsetter,
  codePoints: readonly number[],
  options: SubsetOptions,
): Promise<{ woff2: Uint8Array; sfntBytes: number }> {
  const sfnt = await subsetter.subset(codePoints, options);
  const { compressWoff2 } = await import('./woff2');
  return { woff2: await compressWoff2(sfnt), sfntBytes: sfnt.byteLength };
}

const api: EngineWorkerApi = {
  async inspect(file: File, options: InspectOptions): Promise<FontInspection> {
    const normalized = await normalize(file);
    const { inspection } = inspectFont({
      fileName: file.name,
      format: normalized.format,
      sourceSize: normalized.sourceSize,
      normalizedData: normalized.data,
      warnings: normalized.warnings,
    });
    if (!options.calibrate) return inspection;
    try {
      const subsetter = await getSubsetter();
      subsetter.loadFont(normalized.data);
      openKey = null;
      try {
        const options: SubsetOptions = {
          keepHinting: false,
          webFeatures: true,
          trimMetadata: true,
        };
        return await calibrateGlyphCosts(
          inspection,
          async (codePoints) =>
            (await subsetToWoff2(subsetter, codePoints, options)).woff2.byteLength,
        );
      } finally {
        subsetter.unloadFont();
      }
    } catch {
      return { ...inspection, warnings: [...inspection.warnings, { code: 'calibration-failed' }] };
    }
  },

  async open(key: string, file: File): Promise<void> {
    if (openKey === key) return;
    const [normalized, subsetter] = await Promise.all([normalize(file), getSubsetter()]);
    subsetter.unloadFont();
    subsetter.loadFont(normalized.data);
    openKey = key;
  },

  async subset(key: string, request: SubsetRequest): Promise<SubsetResult> {
    if (openKey !== key) throw new Error('字体尚未载入当前线程');
    const subsetter = await getSubsetter();
    const { woff2, sfntBytes } = await subsetToWoff2(
      subsetter,
      request.codePoints,
      subsetOptions(request),
    );
    const data = owned(woff2);
    return transfer({ data, sfntBytes, woff2Bytes: woff2.byteLength }, [data]);
  },

  async close(): Promise<void> {
    openKey = null;
    if (subsetterPromise !== undefined) (await subsetterPromise).unloadFont();
  },
};

expose(api);
