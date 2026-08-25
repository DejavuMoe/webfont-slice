import { describe, expect, it } from 'vitest';
import {
  cyrb53,
  differenceSorted,
  hashHex,
  hasSorted,
  indexOfSorted,
  intersectSorted,
  toSortedUnique,
  unionSorted,
} from './codepoints';

describe('码点集合', () => {
  it('去重排序并拒绝非标量值', () => {
    expect(toSortedUnique([5, 1, 5, 0x20000, 3])).toEqual([1, 3, 5, 0x20000]);
    expect(() => toSortedUnique([0xd800])).toThrow(RangeError);
    expect(() => toSortedUnique([0x110000])).toThrow(RangeError);
  });

  it('多路并集、交集与差集', () => {
    expect(unionSorted([[1, 3, 5], [2, 3], [], [6]])).toEqual([1, 2, 3, 5, 6]);
    expect(unionSorted([])).toEqual([]);
    expect(intersectSorted([1, 2, 3, 7], [2, 3, 4, 7, 9])).toEqual([2, 3, 7]);
    expect(differenceSorted([1, 2, 3, 7], [2, 7, 8])).toEqual([1, 3]);
  });

  it('二分查找', () => {
    const list = [2, 4, 8, 16, 32];
    expect(indexOfSorted(list, 16)).toBe(3);
    expect(indexOfSorted(list, 5)).toBe(-1);
    expect(hasSorted(list, 2)).toBe(true);
    expect(hasSorted([], 2)).toBe(false);
  });

  it('哈希稳定且对内容敏感', () => {
    expect(cyrb53('字体')).toBe(cyrb53('字体'));
    expect(cyrb53('字体')).not.toBe(cyrb53('字休'));
    expect(hashHex(new Uint8Array([1, 2, 3]))).toMatch(/^[0-9a-f]{8}$/u);
    expect(hashHex([1, 2, 3], 12)).toHaveLength(12);
    expect(hashHex(new Uint8Array([1, 2, 3]))).not.toBe(hashHex(new Uint8Array([1, 2, 4])));
  });
});
