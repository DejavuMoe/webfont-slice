import { describe, expect, it } from 'vitest';
import { maxEngineThreads, recommendedThreads } from './threads';

describe('线程推荐', () => {
  it('受核心数与内存预算共同约束', () => {
    expect(maxEngineThreads({ hardwareConcurrency: 16 })).toBe(6);
    expect(maxEngineThreads({ hardwareConcurrency: 1 })).toBe(1);
    expect(recommendedThreads(16 * 1024 * 1024, { hardwareConcurrency: 8, deviceMemory: 8 })).toBe(
      6,
    );
    expect(recommendedThreads(100 * 1024 * 1024, { hardwareConcurrency: 8, deviceMemory: 4 })).toBe(
      2,
    );
    expect(recommendedThreads(100 * 1024 * 1024, { hardwareConcurrency: 8, deviceMemory: 2 })).toBe(
      1,
    );
  });
});
