/**
 * 依据字体体积与设备条件推荐并行线程数。
 *
 * 每个线程保存一份归一化字体，并在 HarfBuzz WASM 堆中再复制一份；堆只增不减，
 * 峰值约为字体体积的 3 倍加上运行时基线。线程数受 CPU 核心与内存预算双重约束。
 */
export interface DeviceProfile {
  readonly hardwareConcurrency?: number;
  /** navigator.deviceMemory（GB），多数非 Chromium 浏览器不提供。 */
  readonly deviceMemory?: number;
}

const MB = 1024 * 1024;
export const MAX_ENGINE_THREADS = 6;

export function maxEngineThreads(device: DeviceProfile): number {
  const cores = device.hardwareConcurrency ?? 4;
  return Math.max(1, Math.min(MAX_ENGINE_THREADS, cores - 1));
}

export function recommendedThreads(normalizedSize: number, device: DeviceProfile): number {
  const memory = device.deviceMemory ?? 4;
  const budget = memory >= 8 ? 1400 * MB : memory >= 4 ? 720 * MB : 320 * MB;
  const perThread = 24 * MB + 3.2 * Math.max(0, normalizedSize);
  const byMemory = Math.floor(budget / perThread);
  return Math.max(1, Math.min(maxEngineThreads(device), byMemory));
}
