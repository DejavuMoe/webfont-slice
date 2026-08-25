export const MAX_UNICODE_CODE_POINT = 0x10ffff;
export const SURROGATE_START = 0xd800;
export const SURROGATE_END = 0xdfff;

export type CodePointRange = readonly [start: number, endInclusive: number];

export function isUnicodeScalarValue(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_UNICODE_CODE_POINT &&
    (value < SURROGATE_START || value > SURROGATE_END)
  );
}

function assertValidCodePoint(value: number): void {
  if (!isUnicodeScalarValue(value)) {
    throw new RangeError(`无效的 Unicode 码点：${String(value)}`);
  }
}

export function validateRanges(ranges: readonly CodePointRange[]): void {
  let previousEnd = -1;

  for (const [start, endInclusive] of ranges) {
    assertValidCodePoint(start);
    assertValidCodePoint(endInclusive);

    if (start > endInclusive) {
      throw new RangeError(`区间起点不能大于终点：${String(start)}-${String(endInclusive)}`);
    }

    if (start <= previousEnd) {
      throw new RangeError('码点区间必须升序排列且不能重叠');
    }

    if (start <= SURROGATE_START && endInclusive >= SURROGATE_END) {
      throw new RangeError('码点区间不能包含 UTF-16 代理项');
    }

    previousEnd = endInclusive;
  }
}

export function compressRanges(codePoints: Iterable<number>): CodePointRange[] {
  const sortedCodePoints = [...new Set(codePoints)].sort((left, right) => left - right);

  for (const codePoint of sortedCodePoints) {
    assertValidCodePoint(codePoint);
  }

  const firstCodePoint = sortedCodePoints[0];
  if (firstCodePoint === undefined) return [];

  const ranges: CodePointRange[] = [];
  let start = firstCodePoint;
  let end = firstCodePoint;

  for (let index = 1; index < sortedCodePoints.length; index += 1) {
    const codePoint = sortedCodePoints[index];
    if (codePoint === undefined) continue;

    if (codePoint === end + 1) {
      end = codePoint;
      continue;
    }

    ranges.push([start, end]);
    start = codePoint;
    end = codePoint;
  }

  ranges.push([start, end]);
  return ranges;
}

export function expandRanges(ranges: readonly CodePointRange[]): number[] {
  validateRanges(ranges);
  const codePoints: number[] = [];

  for (const [start, endInclusive] of ranges) {
    for (let codePoint = start; codePoint <= endInclusive; codePoint += 1) {
      if (isUnicodeScalarValue(codePoint)) codePoints.push(codePoint);
    }
  }

  return codePoints;
}

/** 升序码点中落在区间内的部分（区间需升序、不重叠）。 */
export function filterByRanges(
  codePoints: readonly number[],
  ranges: readonly CodePointRange[],
): number[] {
  const result: number[] = [];
  let range = 0;
  for (const codePoint of codePoints) {
    while (range < ranges.length && (ranges[range]?.[1] ?? 0) < codePoint) range += 1;
    const current = ranges[range];
    if (current === undefined) break;
    if (codePoint >= current[0]) result.push(codePoint);
  }
  return result;
}

export function countRanges(ranges: readonly CodePointRange[]): number {
  validateRanges(ranges);
  return ranges.reduce((total, [start, endInclusive]) => total + endInclusive - start + 1, 0);
}

export function formatCodePoint(codePoint: number): string {
  assertValidCodePoint(codePoint);
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function formatUnicodeRanges(ranges: readonly CodePointRange[]): string {
  validateRanges(ranges);
  return ranges
    .map(([start, endInclusive]) =>
      start === endInclusive
        ? formatCodePoint(start)
        : `${formatCodePoint(start)}-${formatCodePoint(endInclusive).slice(2)}`,
    )
    .join(', ');
}
