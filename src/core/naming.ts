import { formatFontNumericDescriptor, type FontNumericDescriptor, type FontStyle } from './css-gen';

export interface FileNameValues {
  readonly prefix: string;
  readonly weight: FontNumericDescriptor;
  readonly stretch?: FontNumericDescriptor;
  readonly style: FontStyle;
  readonly index: string;
}

/** 把任意字符串收敛为 URL/文件系统安全的小写片段。 */
export function slug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/([a-z\d])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9._]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '');
}

/** 字族名常为中文；无法得到 ASCII 时退回 PostScript 名的字族部分。 */
export function familySlug(family: string, postScriptName: string): string {
  const fromFamily = slug(family);
  if (fromFamily.length >= 2) return fromFamily;
  const fromPostScript = slug(postScriptName.split('-')[0] ?? '');
  return fromPostScript.length > 0 ? fromPostScript : 'webfont';
}

const FILE_PREFIX_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/u;

/** 用户自定义的文件名前缀：字母或数字开头结尾，中间可用 `.` `_` `-`，最长 64 个字符。 */
export function isValidFilePrefix(value: string): boolean {
  return FILE_PREFIX_PATTERN.test(value);
}

/** 分片文件名前缀：用户填写的前缀优先，留空时由字族名生成。 */
export function filePrefixFor(custom: string, family: string, postScriptName: string): string {
  const trimmed = custom.trim();
  return trimmed.length > 0 ? trimmed : familySlug(family, postScriptName);
}

function descriptorToken(value: FontNumericDescriptor): string {
  return formatFontNumericDescriptor(value).replace(/\s+/gu, '_');
}

/** 款式标记：`400`、`700i`、`100_900-w75`。 */
export function variantToken(values: Pick<FileNameValues, 'weight' | 'stretch' | 'style'>): string {
  const style = values.style === 'italic' ? 'i' : values.style === 'oblique' ? 'o' : '';
  const stretch =
    values.stretch === undefined || values.stretch === 100
      ? ''
      : `-w${descriptorToken(values.stretch)}`;
  return `${descriptorToken(values.weight)}${style}${stretch}`;
}

/**
 * 分片文件名：`<prefix>-<variant>-<index>[.<hash>].woff2`。
 * 内容哈希让文件可以设置一年期 immutable 缓存；规划阶段没有字节时不带哈希。
 */
export function fileNameFor(values: FileNameValues, hash?: string): string {
  const stem = [values.prefix, variantToken(values), values.index]
    .join('-')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/-{2,}/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '');
  if (stem.length === 0) throw new Error('无法生成文件名');
  return hash === undefined ? `${stem}.woff2` : `${stem}.${hash}.woff2`;
}
