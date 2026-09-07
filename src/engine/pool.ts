import { wrap, type Remote } from 'comlink';
import type { FontEngine, SubsetRequest, SubsetResult, SubsetSession } from '../app/ports';
import type { FontInspection } from '../core/font-inspection';
import type { EngineWorkerApi } from './protocol';

/**
 * 字体引擎线程池。
 *
 * - 体检：每个字体占用一个线程，多个字体并行分析。
 * - 生成：同一字体在 N 个线程中各载入一次，分片任务由空闲线程领取。
 *   N 由调用方依据字体体积与设备内存决定（见 core/threads）。
 * - 取消：终止全部线程，未决调用立即以 AbortError 结束；下次使用时懒重建。
 *
 * 线程的 WASM 堆只增不减，因此任务结束后调用 trim() 回收空闲线程。
 */

interface Slot {
  readonly worker: Worker;
  readonly api: Remote<EngineWorkerApi>;
  readonly crashed: Promise<never>;
  busy: boolean;
}

function abortError(): DOMException {
  return new DOMException('本地任务已取消', 'AbortError');
}

function race<T>(promise: Promise<T>, signal: AbortSignal, crashed: Promise<never>): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.race([promise, crashed]).then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(
          error instanceof Error || error instanceof DOMException
            ? error
            : new Error(String(error)),
        );
      },
    );
  });
}

function createEngineWorker(): Worker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), {
    type: 'module',
    name: 'webfont-slice-engine',
  });
}

export class EnginePool implements FontEngine {
  readonly #maxWorkers: number;
  readonly #createWorker: () => Worker;
  #slots: Slot[] = [];
  #waiters: { resolve: (slot: Slot) => void; reject: (error: unknown) => void }[] = [];

  constructor(options: { readonly maxWorkers: number; readonly createWorker?: () => Worker }) {
    this.#maxWorkers = Math.max(1, Math.floor(options.maxWorkers));
    this.#createWorker = options.createWorker ?? createEngineWorker;
  }

  get maxWorkers(): number {
    return this.#maxWorkers;
  }

  async inspect(file: File, signal: AbortSignal): Promise<FontInspection> {
    const slot = await this.#acquire(signal);
    try {
      return await race(slot.api.inspect(file, { calibrate: true }), signal, slot.crashed);
    } finally {
      this.#release(slot);
    }
  }

  async openSession(
    file: File,
    key: string,
    threads: number,
    signal: AbortSignal,
  ): Promise<SubsetSession> {
    const wanted = Math.max(1, Math.min(this.#maxWorkers, Math.floor(threads)));
    const slots: Slot[] = [await this.#acquire(signal)];
    while (slots.length < wanted) {
      const extra = this.#tryAcquire();
      if (extra === null) break;
      slots.push(extra);
    }
    try {
      await Promise.all(slots.map((slot) => race(slot.api.open(key, file), signal, slot.crashed)));
    } catch (error: unknown) {
      for (const slot of slots) this.#release(slot);
      throw error;
    }
    return new PooledSession(slots, key, (released) => {
      for (const slot of released) this.#release(slot);
    });
  }

  trim(): void {
    const idle = this.#slots.filter((slot) => !slot.busy);
    for (const slot of idle) slot.worker.terminate();
    this.#slots = this.#slots.filter((slot) => slot.busy);
  }

  terminate(): void {
    for (const slot of this.#slots) slot.worker.terminate();
    this.#slots = [];
    const waiters = this.#waiters;
    this.#waiters = [];
    for (const waiter of waiters) waiter.reject(abortError());
  }

  #spawn(): Slot {
    const worker = this.#createWorker();
    const crashed = new Promise<never>((_, reject) => {
      worker.addEventListener('error', (event: ErrorEvent) => {
        event.preventDefault();
        reject(new Error(event.message || '字体引擎线程异常退出'));
      });
    });
    void crashed.catch(() => undefined);
    const slot: Slot = { worker, api: wrap<EngineWorkerApi>(worker), crashed, busy: true };
    this.#slots.push(slot);
    return slot;
  }

  #tryAcquire(): Slot | null {
    const idle = this.#slots.find((slot) => !slot.busy);
    if (idle !== undefined) {
      idle.busy = true;
      return idle;
    }
    return this.#slots.length < this.#maxWorkers ? this.#spawn() : null;
  }

  #acquire(signal: AbortSignal): Promise<Slot> {
    if (signal.aborted) return Promise.reject(abortError());
    const slot = this.#tryAcquire();
    if (slot !== null) return Promise.resolve(slot);
    return new Promise<Slot>((resolve, reject) => {
      const waiter = {
        resolve: (acquired: Slot) => {
          signal.removeEventListener('abort', onAbort);
          resolve(acquired);
        },
        reject: (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          reject(error instanceof Error || error instanceof DOMException ? error : abortError());
        },
      };
      const onAbort = () => {
        this.#waiters = this.#waiters.filter((candidate) => candidate !== waiter);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#waiters.push(waiter);
    });
  }

  #release(slot: Slot): void {
    if (!this.#slots.includes(slot)) return;
    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(slot);
      return;
    }
    slot.busy = false;
  }
}

class PooledSession implements SubsetSession {
  readonly #key: string;
  readonly #all: readonly Slot[];
  readonly #free: Slot[];
  readonly #waiting: ((slot: Slot) => void)[] = [];
  readonly #onClose: (slots: readonly Slot[]) => void;
  #closed = false;

  constructor(slots: readonly Slot[], key: string, onClose: (slots: readonly Slot[]) => void) {
    this.#all = slots;
    this.#free = [...slots];
    this.#key = key;
    this.#onClose = onClose;
  }

  get threads(): number {
    return this.#all.length;
  }

  async subset(request: SubsetRequest, signal: AbortSignal): Promise<SubsetResult> {
    if (this.#closed) throw new Error('分片会话已结束');
    const slot = await this.#take(signal);
    try {
      return await race(slot.api.subset(this.#key, request), signal, slot.crashed);
    } finally {
      this.#give(slot);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.allSettled(this.#all.map((slot) => slot.api.close()));
    this.#onClose(this.#all);
  }

  #take(signal: AbortSignal): Promise<Slot> {
    if (signal.aborted) return Promise.reject(abortError());
    const slot = this.#free.pop();
    if (slot !== undefined) return Promise.resolve(slot);
    return new Promise<Slot>((resolve, reject) => {
      const onAbort = () => {
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.#waiting.push((acquired) => {
        signal.removeEventListener('abort', onAbort);
        resolve(acquired);
      });
    });
  }

  #give(slot: Slot): void {
    const next = this.#waiting.shift();
    if (next !== undefined) next(slot);
    else this.#free.push(slot);
  }
}
