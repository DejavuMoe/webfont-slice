import { compressRanges, formatUnicodeRanges } from './range-codec';

export type FontStyle = 'normal' | 'italic' | 'oblique';
export type FontNumericDescriptor = number | readonly [number, number];
export type CssFontDisplay = 'auto' | 'block' | 'swap' | 'fallback' | 'optional';

export const FONT_DISPLAY_VALUES: readonly CssFontDisplay[] = [
  'swap',
  'fallback',
  'optional',
  'block',
  'auto',
];

export interface CssShard {
  readonly fileName: string;
  readonly codePoints: readonly number[];
  readonly preload: boolean;
}

export interface CssFace {
  readonly family: string;
  readonly weight: FontNumericDescriptor;
  readonly stretch?: FontNumericDescriptor;
  readonly style: FontStyle;
  readonly shards: readonly CssShard[];
}

export interface CssOptions {
  readonly urlPrefix?: string;
  readonly fontDisplay?: CssFontDisplay;
  readonly generatedAt?: string;
}

export function escapeCssString(value: string): string {
  let escaped = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0xfffd;
    if (character === '\\') escaped += '\\\\';
    else if (character === '"') escaped += '\\"';
    else if (codePoint === 0) escaped += '\uFFFD';
    else if (codePoint === 0x3c || codePoint === 0x3e) escaped += `\\${codePoint.toString(16)} `;
    else if (codePoint <= 0x1f || codePoint === 0x7f) escaped += `\\${codePoint.toString(16)} `;
    else escaped += character;
  }
  return escaped;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}

/** 注释内容不能提前闭合注释，也不能在 CSS 被内联进 <style> 时闭合标签。 */
function escapeCssComment(value: string): string {
  return value
    .replace(/\*\//gu, '*∕')
    .replace(/</gu, '‹')
    .replace(/>/gu, '›')
    .replace(/[\u0000-\u001F\u007F]/gu, ' ');
}

export function validateUrlPrefix(value: string): string {
  const prefix = value.trim();
  if (prefix.length === 0) return '';
  if (prefix.length > 2048) throw new Error('字体 URL 前缀不能超过 2048 个字符');
  if (/[\\\u0000-\u001F\u007F\s"'()<>]/u.test(prefix)) {
    throw new Error('字体 URL 前缀包含非法字符');
  }
  if (prefix.startsWith('//')) throw new Error('字体 URL 前缀必须明确使用 http:// 或 https://');
  const scheme = /^([a-z][a-z\d+.-]*):/iu.exec(prefix)?.[1]?.toLocaleLowerCase();
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    throw new Error('字体 URL 前缀只允许相对路径、http:// 或 https://');
  }
  return prefix.replace(/\/+$/u, '');
}

export function formatFontNumericDescriptor(value: FontNumericDescriptor, unit = ''): string {
  const format = (item: number) => `${String(Number(item.toFixed(4)))}${unit}`;
  return typeof value === 'number' ? format(value) : `${format(value[0])} ${format(value[1])}`;
}

export function shardUrl(fileName: string, prefix: string): string {
  return prefix.length === 0 ? `./fonts/${fileName}` : `${prefix}/${fileName}`;
}

/** 只声明本字体；回退字体栈由使用者自己追加。 */
export function fontFamilyValue(family: string): string {
  return `"${escapeCssString(family)}"`;
}

export function generateFontFaceCss(faces: readonly CssFace[], options: CssOptions = {}): string {
  const prefix = validateUrlPrefix(options.urlPrefix ?? '');
  const display = options.fontDisplay ?? 'swap';
  const families = [...new Map(faces.map((face) => [face.family, face])).values()];
  const shardCount = faces.reduce((total, face) => total + face.shards.length, 0);

  const header = [
    '/*!',
    ` * ${escapeCssComment(families.map((face) => face.family).join(', '))}`,
    ` * ${String(shardCount)} unicode-range shards · generated locally by WebFont Slice${
      options.generatedAt === undefined ? '' : ` · ${escapeCssComment(options.generatedAt)}`
    }`,
    ...families.map((face) => ` * font-family: ${escapeCssComment(fontFamilyValue(face.family))};`),
    ' */',
  ].join('\n');

  const blocks: string[] = [header];
  for (const face of faces) {
    for (const shard of face.shards) {
      blocks.push(
        [
          '@font-face {',
          `  font-family: "${escapeCssString(face.family)}";`,
          `  font-style: ${face.style};`,
          `  font-weight: ${formatFontNumericDescriptor(face.weight)};`,
          ...(face.stretch === undefined
            ? []
            : [`  font-stretch: ${formatFontNumericDescriptor(face.stretch, '%')};`]),
          `  font-display: ${display};`,
          `  src: url("${escapeCssString(shardUrl(shard.fileName, prefix))}") format("woff2");`,
          `  unicode-range: ${formatUnicodeRanges(compressRanges(shard.codePoints))};`,
          '}',
        ].join('\n'),
      );
    }
  }

  return `${blocks.join('\n\n')}\n`;
}

export function generatePreloadHtml(faces: readonly CssFace[], urlPrefix = ''): string {
  const prefix = validateUrlPrefix(urlPrefix);
  return faces
    .flatMap((face) => face.shards.filter((shard) => shard.preload))
    .map(
      (shard) =>
        `<link rel="preload" href="${escapeHtml(shardUrl(shard.fileName, prefix))}" as="font" type="font/woff2" crossorigin>`,
    )
    .join('\n');
}
