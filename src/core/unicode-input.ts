import { isUnicodeScalarValue, MAX_UNICODE_CODE_POINT } from './range-codec';

export interface UnicodeInputError {
  readonly token: string;
  readonly offset: number;
  readonly message: string;
}

export interface UnicodeInputResult {
  readonly codePoints: ReadonlySet<number>;
  readonly errors: readonly UnicodeInputError[];
}

const TOKEN_PATTERN = /^U\+([\dA-F]{1,6})(?:-(?:U\+)?([\dA-F]{1,6}))?$/iu;
const DEFAULT_MAX_EXPANDED_CODE_POINTS = 250_000;

export function parseUnicodeInput(
  input: string,
  maxExpandedCodePoints = DEFAULT_MAX_EXPANDED_CODE_POINTS,
): UnicodeInputResult {
  const codePoints = new Set<number>();
  const errors: UnicodeInputError[] = [];
  const tokenPattern = /[^\s,;]+/gu;

  for (const tokenMatch of input.matchAll(tokenPattern)) {
    const token = tokenMatch[0];
    const offset = tokenMatch.index;
    const match = TOKEN_PATTERN.exec(token);
    if (match === null) {
      errors.push({ token, offset, message: '请使用 U+4E00 或 U+4E00-9FFF 格式' });
      continue;
    }

    const start = Number.parseInt(match[1] ?? '', 16);
    const end = Number.parseInt(match[2] ?? match[1] ?? '', 16);
    if (start > MAX_UNICODE_CODE_POINT || end > MAX_UNICODE_CODE_POINT) {
      errors.push({ token, offset, message: '码点不能超过 U+10FFFF' });
      continue;
    }
    if (start > end) {
      errors.push({ token, offset, message: '区间起点不能大于终点' });
      continue;
    }
    if (!isUnicodeScalarValue(start) || !isUnicodeScalarValue(end)) {
      errors.push({ token, offset, message: '区间端点不能是 UTF-16 代理项' });
      continue;
    }
    if (start <= 0xdfff && end >= 0xd800) {
      errors.push({ token, offset, message: '区间不能包含 U+D800–DFFF 代理项' });
      continue;
    }
    let additions = 0;
    for (let codePoint = start; codePoint <= end; codePoint += 1) {
      if (!codePoints.has(codePoint)) additions += 1;
      if (codePoints.size + additions > maxExpandedCodePoints) break;
    }
    if (codePoints.size + additions > maxExpandedCodePoints) {
      errors.push({
        token,
        offset,
        message: `展开后不能超过 ${maxExpandedCodePoints.toLocaleString('zh-CN')} 个码点`,
      });
      continue;
    }

    for (let codePoint = start; codePoint <= end; codePoint += 1) codePoints.add(codePoint);
  }

  return { codePoints, errors };
}
