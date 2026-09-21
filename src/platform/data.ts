import {
  parseCharsetIndex,
  parseCharsetPreset,
  type CharsetIndex,
  type CharsetPreset,
} from '../core/charset-store';
import { parseFrequencyData, type FrequencyData } from '../core/frequency';
import type { CharsetRepository } from '../app/ports';

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`数据加载失败（HTTP ${String(response.status)}）：${url}`);
  return response.json() as Promise<unknown>;
}

/** 失败的 Promise 会从缓存中移除，下一次调用可以重试。 */
function cached<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = load();
    cache.set(key, pending);
    const current = pending;
    void current.catch(() => {
      if (cache.get(key) === current) cache.delete(key);
    });
  }
  return pending;
}

export function createCharsetRepository(baseUrl = import.meta.env.BASE_URL): CharsetRepository {
  const root = baseUrl.replace(/\/?$/u, '/');
  const indexCache = new Map<string, Promise<CharsetIndex>>();
  const presetCache = new Map<string, Promise<CharsetPreset>>();
  const frequencyCache = new Map<string, Promise<FrequencyData>>();
  return {
    loadIndex: () =>
      cached(indexCache, 'index', async () =>
        parseCharsetIndex(await fetchJson(`${root}charsets/index.json`)),
      ),
    loadPreset: (id) => {
      if (!/^[a-z][a-z\d-]+$/u.test(id)) return Promise.reject(new Error(`无效字符集 ID：${id}`));
      return cached(presetCache, id, async () =>
        parseCharsetPreset(await fetchJson(`${root}charsets/${id}.json`)),
      );
    },
    loadFrequency: () =>
      cached(frequencyCache, 'han', async () =>
        parseFrequencyData(await fetchJson(`${root}freq/han-freq.json`)),
      ),
  };
}
