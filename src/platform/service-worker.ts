export interface ServiceWorkerStatus {
  readonly offlineReady: boolean;
  readonly updateAvailable: boolean;
}

export interface ServiceWorkerPort {
  /** 订阅注册状态；返回取消订阅函数。 */
  subscribe(listener: (status: ServiceWorkerStatus) => void): () => void;
  /** 激活等待中的新版本并重载。只应由用户显式操作触发。 */
  applyUpdate(): Promise<void>;
}

/**
 * `virtual:pwa-register` 是 vite-plugin-pwa 的构建期虚拟模块，
 * 在 Vitest 下由 vitest.config.ts 的 alias 指向 stub。
 */
type RegisterSW = (options: {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
}) => (reloadPage?: boolean) => Promise<void>;

/**
 * 包住 Service Worker 注册，使 UI 只依赖 port。
 *
 * 注册类型为 prompt：新版本下载完成后**不会**自动激活或重载，
 * 只把状态推给订阅者，由上层决定何时提示、由用户决定何时刷新。
 */
export class BrowserServiceWorker implements ServiceWorkerPort {
  #status: ServiceWorkerStatus = { offlineReady: false, updateAvailable: false };
  #listeners = new Set<(status: ServiceWorkerStatus) => void>();
  #update: ((reloadPage?: boolean) => Promise<void>) | null = null;
  #started = false;

  constructor(
    private readonly register: RegisterSW,
    private readonly isControlled: () => boolean = () => false,
  ) {}

  subscribe(listener: (status: ServiceWorkerStatus) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#status);
    this.#start();
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async applyUpdate(): Promise<void> {
    await this.#update?.(true);
  }

  #start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#update = this.register({
      immediate: true,
      onOfflineReady: () => {
        this.#emit({ ...this.#status, offlineReady: true });
      },
      onNeedRefresh: () => {
        this.#emit({ ...this.#status, updateAvailable: true });
      },
    });
    // onOfflineReady 只在首次安装时触发；再次访问时页面已由 Service Worker 控制，同样可离线。
    if (this.isControlled()) this.#emit({ ...this.#status, offlineReady: true });
  }

  #emit(status: ServiceWorkerStatus): void {
    this.#status = status;
    for (const listener of this.#listeners) listener(status);
  }
}

export async function createBrowserServiceWorker(): Promise<BrowserServiceWorker> {
  const module = await import('virtual:pwa-register');
  return new BrowserServiceWorker(
    module.registerSW,
    () => typeof navigator !== 'undefined' && navigator.serviceWorker.controller !== null,
  );
}
