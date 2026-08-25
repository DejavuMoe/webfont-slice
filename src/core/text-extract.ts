import type { CustomTextStatistics } from './frequency';
import { isUnicodeScalarValue } from './range-codec';

export interface TextExtractOptions {
  readonly includeWhitespace?: boolean;
}

function isFontSpacingCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x20 ||
    codePoint === 0xa0 ||
    codePoint === 0x1680 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

function isControl(codePoint: number): boolean {
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint < 0xa0);
}

function isWhitespace(character: string): boolean {
  return /^\s$/u.test(character);
}

export function extractCodePoints(
  text: string,
  options: TextExtractOptions = {},
): ReadonlySet<number> {
  const includeWhitespace = options.includeWhitespace ?? false;
  const codePoints = new Set<number>();

  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isUnicodeScalarValue(codePoint) || isControl(codePoint)) {
      continue;
    }
    if (isWhitespace(character)) {
      if (!includeWhitespace || !isFontSpacingCharacter(codePoint)) continue;
    }
    codePoints.add(codePoint);
  }

  return codePoints;
}

/** 统计正文中每个字符的出现次数，用于把站点真实用字混入字频模型。 */
export function textStatistics(text: string): CustomTextStatistics {
  const counts = new Map<number, number>();
  let total = 0;
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || isControl(codePoint) || isWhitespace(character)) continue;
    counts.set(codePoint, (counts.get(codePoint) ?? 0) + 1);
    total += 1;
  }
  return { counts, total };
}

/** 汉字（CJK 统一表意文字及扩展、兼容区）。 */
export function isHanCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x323af)
  );
}
