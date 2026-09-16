import type { CharsetIndex, CharsetPreset } from '../core/charset-store';
import type { FontInspection } from '../core/font-inspection';
import type { FrequencyData } from '../core/frequency';

/** 单个分片的子集化请求；字体已在会话打开时载入各线程。 */
export interface SubsetRequest {
  readonly codePoints: readonly number[];
  readonly variationAxes?: Readonly<Record<string, number>>;
  readonly keepHinting: boolean;
  readonly webFeatures: boolean;
  readonly trimMetadata: boolean;
}

export interface SubsetResult {
  readonly data: ArrayBuffer;
  readonly sfntBytes: number;
  readonly woff2Bytes: number;
}

export interface SubsetSession {
  readonly threads: number;
  subset(request: SubsetRequest, signal: AbortSignal): Promise<SubsetResult>;
  close(): Promise<void>;
}

/** 字体引擎：分析字体、按线程数打开子集化会话；terminate 立即终止全部线程。 */
export interface FontEngine {
  inspect(file: File, signal: AbortSignal): Promise<FontInspection>;
  openSession(
    file: File,
    key: string,
    threads: number,
    signal: AbortSignal,
  ): Promise<SubsetSession>;
  trim(): void;
  terminate(): void;
}

/** 字表与字频数据；失败的加载可以重试。 */
export interface CharsetRepository {
  loadIndex(): Promise<CharsetIndex>;
  loadPreset(id: string): Promise<CharsetPreset>;
  loadFrequency(): Promise<FrequencyData>;
}
