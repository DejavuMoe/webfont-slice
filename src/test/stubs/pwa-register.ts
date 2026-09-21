/**
 * `virtual:pwa-register` 的测试替身。
 * 生产构建由 vite-plugin-pwa 生成同名虚拟模块；Vitest 通过 alias 指到这里，
 * 使 platform 适配器可以在没有 Service Worker 的环境下被单测覆盖。
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return () => Promise.resolve();
}
