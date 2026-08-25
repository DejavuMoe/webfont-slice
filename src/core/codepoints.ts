import { isUnicodeScalarValue } from './range-codec';

/** 升序、去重的码点列表。所有集合运算都假设输入满足该不变量。 */
export type CodePointList = readonly number[];

export function toSortedUnique(values: Iterable<number>): number[] {
  const unique = [...new Set(values)];
  for (const value of unique) {
    if (!isUnicodeScalarValue(value)) throw new RangeError(`无效码点：${String(value)}`);
  }
  return unique.sort((left, right) => left - right);
}

/** k 路归并求并集，O(总长度 · log k) 以内。 */
export function unionSorted(lists: readonly CodePointList[]): number[] {
  const nonEmpty = lists.filter((list) => list.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return [...(nonEmpty[0] ?? [])];
  let merged: number[] = [...(nonEmpty[0] ?? [])];
  for (let index = 1; index < nonEmpty.length; index += 1) {
    merged = mergeTwo(merged, nonEmpty[index] ?? []);
  }
  return merged;
}

function mergeTwo(left: CodePointList, right: CodePointList): number[] {
  const output: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i] ?? 0;
    const b = right[j] ?? 0;
    if (a === b) {
      output.push(a);
      i += 1;
      j += 1;
    } else if (a < b) {
      output.push(a);
      i += 1;
    } else {
      output.push(b);
      j += 1;
    }
  }
  while (i < left.length) output.push(left[i++] ?? 0);
  while (j < right.length) output.push(right[j++] ?? 0);
  return output;
}

export function intersectSorted(left: CodePointList, right: CodePointList): number[] {
  const output: number[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const a = left[i] ?? 0;
    const b = right[j] ?? 0;
    if (a === b) {
      output.push(a);
      i += 1;
      j += 1;
    } else if (a < b) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return output;
}

export function differenceSorted(left: CodePointList, right: CodePointList): number[] {
  const output: number[] = [];
  let j = 0;
  for (const value of left) {
    while (j < right.length && (right[j] ?? 0) < value) j += 1;
    if (right[j] !== value) output.push(value);
  }
  return output;
}

export function hasSorted(list: CodePointList, value: number): boolean {
  return indexOfSorted(list, value) >= 0;
}

export function indexOfSorted(list: CodePointList, value: number): number {
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = list[middle] ?? 0;
    if (candidate === value) return middle;
    if (candidate < value) low = middle + 1;
    else high = middle - 1;
  }
  return -1;
}

/**
 * cyrb53：快速、分布良好的 53 位非加密哈希。
 * 用于输入指纹与文件名内容哈希；不用于安全用途。
 */
export function cyrb53(input: string | Uint8Array | CodePointList, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  const length = input.length;
  for (let index = 0; index < length; index += 1) {
    const value = typeof input === 'string' ? input.charCodeAt(index) : (input[index] ?? 0) >>> 0;
    h1 = Math.imul(h1 ^ value, 2654435761);
    h2 = Math.imul(h2 ^ value, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashHex(input: string | Uint8Array | CodePointList, length = 8): string {
  return cyrb53(input).toString(16).padStart(14, '0').slice(-length);
}
