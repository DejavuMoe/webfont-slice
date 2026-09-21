import { afterEach, expect, it, vi } from 'vitest';
import { createCharsetRepository } from './data';

afterEach(() => {
  vi.unstubAllGlobals();
});

const INDEX = {
  version: 1,
  presets: [
    {
      id: 'u-test',
      name: 'Test',
      category: 'unicode',
      expectedCount: 1,
      standard: 'Test',
      description: 'Test',
    },
  ],
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

it('瞬时失败不会被永久缓存，可以重试；成功结果被缓存', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(json(INDEX));
  vi.stubGlobal('fetch', fetchMock);
  const repository = createCharsetRepository('/app');

  await expect(repository.loadIndex()).rejects.toThrow('offline');
  await expect(repository.loadIndex()).resolves.toMatchObject({ version: 1 });
  await expect(repository.loadIndex()).resolves.toMatchObject({ version: 1 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith('/app/charsets/index.json');
});

it('HTTP 错误会报告状态码；非法预设 ID 不发请求', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({}, 404));
  vi.stubGlobal('fetch', fetchMock);
  const repository = createCharsetRepository('./');

  await expect(repository.loadFrequency()).rejects.toThrow('HTTP 404');
  await expect(repository.loadPreset('../secret')).rejects.toThrow('无效字符集 ID');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith('./freq/han-freq.json');
});
