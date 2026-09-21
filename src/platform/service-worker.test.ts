import { describe, expect, it, vi } from 'vitest';
import type { ServiceWorkerStatus } from './service-worker';
import { BrowserServiceWorker } from './service-worker';

interface RegisterOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}

function harness() {
  let captured: RegisterOptions | null = null;
  const update = vi.fn<(reloadPage?: boolean) => Promise<void>>().mockResolvedValue(undefined);
  const register = vi.fn((options: RegisterOptions) => {
    captured = options;
    return update;
  });
  const worker = new BrowserServiceWorker(register);
  return {
    worker,
    register,
    update,
    get options(): RegisterOptions {
      if (captured === null) throw new Error('registerSW 尚未被调用');
      return captured;
    },
  };
}

describe('BrowserServiceWorker', () => {
  it('首个订阅者立即收到当前状态并触发注册', () => {
    const { worker, register } = harness();
    const seen: ServiceWorkerStatus[] = [];

    worker.subscribe((status) => seen.push(status));

    expect(register).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ offlineReady: false, updateAvailable: false }]);
  });

  it('多次订阅只注册一次 Service Worker', () => {
    const { worker, register } = harness();

    worker.subscribe(() => undefined);
    worker.subscribe(() => undefined);

    expect(register).toHaveBeenCalledTimes(1);
  });

  it('把离线就绪与新版本可用推给全部订阅者', () => {
    const context = harness();
    const seen: ServiceWorkerStatus[] = [];
    context.worker.subscribe((status) => seen.push(status));

    context.options.onOfflineReady?.();
    context.options.onNeedRefresh?.();

    expect(seen.at(-1)).toEqual({ offlineReady: true, updateAvailable: true });
  });

  it('取消订阅后不再收到推送', () => {
    const context = harness();
    const seen: ServiceWorkerStatus[] = [];
    const unsubscribe = context.worker.subscribe((status) => seen.push(status));

    unsubscribe();
    context.options.onNeedRefresh?.();

    expect(seen).toHaveLength(1);
  });

  it('新版本就绪本身不会重载页面', () => {
    const context = harness();
    context.worker.subscribe(() => undefined);

    context.options.onNeedRefresh?.();

    expect(context.update).not.toHaveBeenCalled();
  });

  it('只有显式 applyUpdate 才激活新版本并重载', async () => {
    const { worker, update } = harness();
    worker.subscribe(() => undefined);

    await worker.applyUpdate();

    expect(update).toHaveBeenCalledWith(true);
  });

  it('已被 Service Worker 控制的页面直接视为可离线', () => {
    const worker = new BrowserServiceWorker(
      () => () => Promise.resolve(),
      () => true,
    );
    const seen: ServiceWorkerStatus[] = [];
    worker.subscribe((status) => seen.push(status));
    expect(seen.at(-1)).toEqual({ offlineReady: true, updateAvailable: false });
  });
});
