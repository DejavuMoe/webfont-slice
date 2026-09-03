import compressBindingUrl from '../generated/wawoff2/compress-binding.js?url';
import compressWasmUrl from '../generated/wawoff2/compress-binding.wasm?url';
import decompressBindingUrl from '../generated/wawoff2/decompress-binding.js?url';
import decompressWasmUrl from '../generated/wawoff2/decompress-binding.wasm?url';
import {
  MAX_SFNT_TABLE_COUNT,
  assertNormalizedFontSize,
  assertWoff2IntermediateBudget,
} from './font-budget';
import runtimeWorkerUrl from './wawoff2-runtime.classic.js?url';

type OperationName = 'compress' | 'decompress';
type NodeOperation = (input: Uint8Array) => Promise<Uint8Array>;

const WOFF2_HEADER_SIZE = 48;
const WOFF2_SIGNATURE = 0x774f4632;
const TTC_FLAVOR = 0x74746366;
const EXPLICIT_TAG_INDEX = 63;
const HMTX_TAG_INDEX = 3;
const GLYF_TAG_INDEX = 10;
const LOCA_TAG_INDEX = 11;
const HMTX_TAG = 0x686d7478;
const GLYF_TAG = 0x676c7966;
const LOCA_TAG = 0x6c6f6361;
const TOTAL_SFNT_SIZE_OFFSET = 16;

interface PendingOperation {
  readonly resolve: (data: Uint8Array) => void;
  readonly reject: (error: Error) => void;
}

export interface Woff2DecompressionBudget {
  readonly intermediateSize: number;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

class Woff2DirectoryReader {
  readonly #view: DataView;
  #offset = WOFF2_HEADER_SIZE;

  constructor(data: Uint8Array) {
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  readUint8(): number {
    if (this.#offset >= this.#view.byteLength) throw new Error('WOFF2 表目录不完整');
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  readUint32(): number {
    if (this.#offset + 4 > this.#view.byteLength) throw new Error('WOFF2 表目录不完整');
    const value = this.#view.getUint32(this.#offset, false);
    this.#offset += 4;
    return value;
  }

  readUIntBase128(): number {
    let result = 0;
    for (let index = 0; index < 5; index += 1) {
      const value = this.readUint8();
      if (index === 0 && value === 0x80) {
        throw new Error('WOFF2 UIntBase128 含无效前导零');
      }
      if (result > 0x01ffffff) {
        throw new Error('WOFF2 UIntBase128 超出 32 位范围');
      }
      result = result * 128 + (value & 0x7f);
      if ((value & 0x80) === 0) return result;
    }
    throw new Error('WOFF2 UIntBase128 长度超过 5 字节');
  }
}

function knownTag(tagIndex: number): number | undefined {
  if (tagIndex === HMTX_TAG_INDEX) return HMTX_TAG;
  if (tagIndex === GLYF_TAG_INDEX) return GLYF_TAG;
  if (tagIndex === LOCA_TAG_INDEX) return LOCA_TAG;
  return undefined;
}

function isTransformedTable(tag: number | undefined, transformVersion: number): boolean {
  if (tag === GLYF_TAG || tag === LOCA_TAG) {
    if (transformVersion === 0) return true;
    if (transformVersion === 3) return false;
    throw new Error('WOFF2 glyf/loca 表使用了不支持的 transform version');
  }
  if (tag === HMTX_TAG) {
    if (transformVersion === 0) return false;
    if (transformVersion === 1) return true;
    throw new Error('WOFF2 hmtx 表使用了不支持的 transform version');
  }
  if (transformVersion !== 0) {
    throw new Error('WOFF2 表使用了不支持的 transform version');
  }
  return false;
}

function decoderInputWithoutAdvisorySize(woff2: Uint8Array): Uint8Array {
  const input = Uint8Array.from(woff2);
  // wawoff2 2.0.1 binding 会用该 advisory 字段预分配；实际 decoder 明确忽略它。
  new DataView(input.buffer).setUint32(TOTAL_SFNT_SIZE_OFFSET, 0, false);
  return input;
}

/**
 * 在启动 Brotli/WASM decoder 前，按 WOFF2 目录计算实际中间态展开预算。
 *
 * totalSfntSize 对 transformed glyf 只是 advisory，不能作为分配或安全判断依据。
 */
export function inspectWoff2DecompressionBudget(woff2: Uint8Array): Woff2DecompressionBudget {
  if (woff2.byteLength < WOFF2_HEADER_SIZE) throw new Error('WOFF2 文件头不完整');
  const view = new DataView(woff2.buffer, woff2.byteOffset, woff2.byteLength);
  if (view.getUint32(0, false) !== WOFF2_SIGNATURE) throw new Error('WOFF2 签名无效');
  if (view.getUint32(4, false) === TTC_FLAVOR) {
    throw new Error('暂不支持 TTC/OTC 字体合集，请先导出单个字体');
  }
  if (view.getUint32(8, false) !== woff2.byteLength) {
    throw new Error('WOFF2 声明长度与文件大小不一致');
  }

  const tableCount = view.getUint16(12, false);
  if (tableCount === 0 || tableCount > MAX_SFNT_TABLE_COUNT) {
    throw new Error('WOFF2 表数量无效');
  }
  const reader = new Woff2DirectoryReader(woff2);
  let intermediateSize = 0;
  for (let index = 0; index < tableCount; index += 1) {
    const flags = reader.readUint8();
    const tagIndex = flags & 0x3f;
    const transformVersion = flags >>> 6;
    const tag = tagIndex === EXPLICIT_TAG_INDEX ? reader.readUint32() : knownTag(tagIndex);
    const originalLength = reader.readUIntBase128();
    const transformed = isTransformedTable(tag, transformVersion);
    const transformLength = transformed ? reader.readUIntBase128() : originalLength;
    if (tag === LOCA_TAG && transformed && transformLength !== 0) {
      throw new Error('WOFF2 transformed loca 表长度必须为 0');
    }

    intermediateSize += transformLength;
    assertWoff2IntermediateBudget(woff2.byteLength, intermediateSize);
  }
  return { intermediateSize };
}

class BrowserWoff2Client {
  readonly #worker: Worker;
  readonly #ready: Promise<void>;
  readonly #pending = new Map<number, PendingOperation>();
  #resolveReady: (() => void) | undefined;
  #rejectReady: ((error: Error) => void) | undefined;
  #nextRequestId = 1;

  constructor(operationName: OperationName, bindingUrl: string, wasmUrl: string) {
    this.#worker = new Worker(runtimeWorkerUrl, { name: `wawoff2-${operationName}` });
    this.#ready = new Promise<void>((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });

    this.#worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.#handleMessage(event.data);
    });
    this.#worker.addEventListener('error', (event: ErrorEvent) => {
      this.#failAll(new Error(event.message || `WOFF2 ${operationName} Worker 运行失败`));
    });
    this.#worker.postMessage({ type: 'init', operationName, bindingUrl, wasmUrl });
  }

  async run(input: Uint8Array): Promise<Uint8Array> {
    await this.#ready;
    const requestId = this.#nextRequestId;
    this.#nextRequestId += 1;
    const data = Uint8Array.from(input).buffer;

    const result = new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject });
    });
    this.#worker.postMessage({ type: 'run', requestId, data }, [data]);
    return result;
  }

  #handleMessage(value: unknown): void {
    const message = record(value);
    if (message === undefined) return;

    if (message.type === 'ready') {
      this.#resolveReady?.();
      this.#resolveReady = undefined;
      this.#rejectReady = undefined;
      return;
    }

    if (message.type === 'init-error' && typeof message.message === 'string') {
      this.#failAll(new Error(message.message));
      return;
    }

    const requestId = message.requestId;
    if (typeof requestId !== 'number') return;
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return;
    this.#pending.delete(requestId);

    if (message.type === 'result' && message.data instanceof ArrayBuffer) {
      pending.resolve(new Uint8Array(message.data));
    } else if (message.type === 'error' && typeof message.message === 'string') {
      pending.reject(new Error(message.message));
    } else {
      pending.reject(new Error('WOFF2 Worker 返回了无效消息'));
    }
  }

  #failAll(error: Error): void {
    this.#rejectReady?.(error);
    this.#resolveReady = undefined;
    this.#rejectReady = undefined;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }
}

let browserCompressClient: BrowserWoff2Client | undefined;
let browserDecompressClient: BrowserWoff2Client | undefined;
let nodeModulePromise: Promise<Readonly<Record<string, unknown>>> | undefined;

function canUseBrowserWorker(): boolean {
  return typeof Worker === 'function' && typeof self !== 'undefined';
}

function browserClient(operationName: OperationName): BrowserWoff2Client {
  if (operationName === 'compress') {
    browserCompressClient ??= new BrowserWoff2Client(
      'compress',
      compressBindingUrl,
      compressWasmUrl,
    );
    return browserCompressClient;
  }
  browserDecompressClient ??= new BrowserWoff2Client(
    'decompress',
    decompressBindingUrl,
    decompressWasmUrl,
  );
  return browserDecompressClient;
}

async function nodeModule(): Promise<Readonly<Record<string, unknown>>> {
  if (nodeModulePromise === undefined) {
    const packageName = 'wawoff2';
    // Node-only fallback: keep this pinned package opaque to Vite's browser dependency scan.
    // eslint-disable-next-line architecture/source-layers
    nodeModulePromise = import(/* @vite-ignore */ packageName).then((value: unknown) => {
      const namespace = record(value);
      const defaultExport = record(namespace?.default);
      const module = defaultExport ?? namespace;
      if (module === undefined) throw new Error('无法加载 Node WOFF2 模块');
      return module;
    });
  }
  return nodeModulePromise;
}

async function runNodeOperation(
  operationName: OperationName,
  input: Uint8Array,
): Promise<Uint8Array> {
  const operation = (await nodeModule())[operationName];
  if (typeof operation !== 'function') throw new Error(`Node WOFF2 模块缺少 ${operationName}`);
  const result: unknown = await (operation as NodeOperation)(input);
  if (!(result instanceof Uint8Array)) throw new Error(`Node WOFF2 ${operationName} 返回无效数据`);
  return Uint8Array.from(result);
}

async function runOperation(operationName: OperationName, input: Uint8Array): Promise<Uint8Array> {
  return canUseBrowserWorker()
    ? browserClient(operationName).run(input)
    : runNodeOperation(operationName, input);
}

export async function compressWoff2(sfnt: Uint8Array): Promise<Uint8Array> {
  if (sfnt.byteLength === 0) throw new Error('不能压缩空字体');
  return runOperation('compress', sfnt);
}

export async function decompressWoff2(woff2: Uint8Array): Promise<Uint8Array> {
  if (woff2.byteLength === 0) throw new Error('不能解压空字体');
  inspectWoff2DecompressionBudget(woff2);
  const result = await runOperation('decompress', decoderInputWithoutAdvisorySize(woff2));
  assertNormalizedFontSize(result.byteLength, 'WOFF2 字体');
  return result;
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
