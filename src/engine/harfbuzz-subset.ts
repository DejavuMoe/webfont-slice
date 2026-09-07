import { init, subset as subsetFont } from 'hb-subset-wasm';
import { WEB_LAYOUT_FEATURES } from '../core/layout-features';
import { isUnicodeScalarValue } from '../core/range-codec';
import type { VariationAxisSettings } from '../core/variation';
import { trimNameTable } from './sfnt';

export const HB_SUBSET_INITIAL_MEMORY_BYTES = 2 * 1024 * 1024;
export const HB_SUBSET_MAXIMUM_MEMORY_BYTES = 256 * 1024 * 1024;

/** 对网页无用、或子集后必然失效的表。 */
const WEB_DROP_TABLES = ['DSIG', 'hdmx', 'LTSH', 'VDMX', 'PCLT'];

export interface SubsetOptions {
  readonly keepHinting?: boolean;
  readonly webFeatures?: boolean;
  readonly trimMetadata?: boolean;
  /** 固定轴值会生成静态实例；范围对象会缩窄但保留对应可变能力。 */
  readonly variationAxes?: VariationAxisSettings;
}

/**
 * 可增长内存版 hb-subset WASM 的生命周期封装。
 *
 * 字体字节在 Worker 的 JS 堆中只保留一份；每次调用由 HarfBuzz 复制进
 * 初始 2 MiB、最大 256 MiB 的 WASM 堆。
 */
export class HarfBuzzSubsetter {
  #fontData: Uint8Array | null = null;
  #disposed = false;

  private constructor() {
    // 通过 create() 构造，确保 WASM 已完成初始化。
  }

  static async create(wasmSource: ArrayBuffer): Promise<HarfBuzzSubsetter> {
    await init(wasmSource);
    return new HarfBuzzSubsetter();
  }

  get hasFont(): boolean {
    return this.#fontData !== null;
  }

  loadFont(fontData: ArrayBuffer): void {
    this.#assertActive();
    if (fontData.byteLength === 0) throw new Error('字体文件为空');
    this.#fontData = new Uint8Array(fontData);
  }

  async subset(codePoints: readonly number[], options: SubsetOptions = {}): Promise<Uint8Array> {
    this.#assertActive();
    if (this.#fontData === null) throw new Error('请先载入字体');

    const unicodes = [...new Set(codePoints)].sort((left, right) => left - right);
    if (unicodes.length === 0) throw new Error('子集码点不能为空');
    for (const codePoint of unicodes) {
      if (!isUnicodeScalarValue(codePoint)) {
        throw new RangeError(`无效的 Unicode 码点：${String(codePoint)}`);
      }
    }

    const trim = options.trimMetadata ?? true;
    let result: Uint8Array;
    try {
      result = await subsetFont(this.#fontData, {
        unicodes,
        noHinting: !(options.keepHinting ?? false),
        retainGids: false,
        // name 不引用字形；先完整透传，再按需精简，确保版权与许可（ID 0/13/14）不丢失。
        passthroughTables: ['name'],
        dropTables: trim ? WEB_DROP_TABLES : ['DSIG'],
        ...((options.webFeatures ?? true) ? { layoutFeatures: [...WEB_LAYOUT_FEATURES] } : {}),
        ...(options.variationAxes === undefined
          ? {}
          : {
              variationAxes: Object.fromEntries(
                Object.entries(options.variationAxes).map(([tag, value]) => [
                  tag,
                  typeof value === 'number' ? value : { ...value },
                ]),
              ),
            }),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`HarfBuzz 子集化失败：${message}`, { cause: error });
    }
    return trim ? trimNameTable(result) : result;
  }

  unloadFont(): void {
    this.#fontData = null;
  }

  dispose(): void {
    this.#fontData = null;
    this.#disposed = true;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('HarfBuzzSubsetter 已释放');
  }
}
