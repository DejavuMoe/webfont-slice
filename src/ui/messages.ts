import type { PlanIssue } from '../core/export-plan';
import type { InspectionWarning } from '../core/font-inspection';
import type { Blocker } from '../app/derive';
import type { FontUploadRejectionCode } from '../app/validate-font-uploads';
import { formatBytes } from './format';

type Text = (chinese: string, english: string) => string;

export function describeIssue(issue: PlanIssue, text: Text): string {
  switch (issue.code) {
    case 'no-characters':
      return text('还没有选择任何字符', 'No characters selected yet');
    case 'no-faces':
      return text('至少需要保留一个字体', 'Keep at least one font');
    case 'face-empty':
      return text(
        `${issue.fileName} 不包含任何所需字符`,
        `${issue.fileName} has none of the requested characters`,
      );
    case 'family-empty':
      return text(`${issue.fileName} 的字族名不能为空`, `${issue.fileName} needs a family name`);
    case 'prefix-invalid':
      return text(
        `${issue.fileName} 的文件名前缀只能用字母、数字和 . _ -，且以字母或数字开头结尾`,
        `${issue.fileName} file prefix may only use letters, digits and . _ -, starting and ending with a letter or digit`,
      );
    case 'weight-invalid':
      return text(
        `${issue.fileName} 的字重需在 1–1000 之间`,
        `${issue.fileName} needs a weight between 1 and 1000`,
      );
    case 'instances-empty':
      return text(
        `${issue.fileName} 至少选择一个固定款式`,
        `Pick at least one instance for ${issue.fileName}`,
      );
    case 'instances-too-many':
      return text(
        `${issue.fileName} 最多导出 ${String(issue.max)} 个固定款式`,
        `${issue.fileName} can export at most ${String(issue.max)} instances`,
      );
    case 'instance-invalid':
      return text(
        `${issue.fileName} 的款式无效：${issue.detail}`,
        `${issue.fileName} has an invalid instance: ${issue.detail}`,
      );
    case 'duplicate-face':
      return text(
        `两个款式都是 ${issue.family} / ${issue.weight} / ${issue.style}，请修改字重或字族名`,
        `Two faces are both ${issue.family} / ${issue.weight} / ${issue.style}; change a weight or family name`,
      );
    case 'duplicate-file':
      return text(`文件名重复：${issue.fileName}`, `Duplicate file name: ${issue.fileName}`);
    case 'url-invalid':
      return text(
        `字体路径无效：${issue.message}`,
        `Invalid font path: ${localizeEngineError(issue.message, text)}`,
      );
  }
}

export function describeBlocker(blocker: Blocker, text: Text): string {
  switch (blocker.code) {
    case 'no-fonts':
      return text('添加字体后即可生成', 'Add a font to begin');
    case 'checking':
      return text('正在检查文件', 'Checking files');
    case 'inspecting':
      return text(
        `正在分析 ${String(blocker.count)} 个字体`,
        `Analyzing ${String(blocker.count)} font(s)`,
      );
    case 'font-error':
      return text(
        `${blocker.name} 无法读取，请移除或重试`,
        `${blocker.name} could not be read; remove or retry it`,
      );
    case 'characters-loading':
      return text('正在载入字表', 'Loading character sets');
    case 'characters-error':
      return text('字表载入失败', 'Character sets failed to load');
    case 'range-error':
      return text('码点区间格式有误', 'The code point ranges contain errors');
    case 'running':
      return text('正在生成', 'Generating');
  }
}

export function describeRejection(code: FontUploadRejectionCode, text: Text): string {
  switch (code) {
    case 'empty-file':
      return text('空文件', 'Empty file');
    case 'font-too-large':
      return text('超过 100 MB', 'Larger than 100 MB');
    case 'font-collection':
      return text(
        'TTC/OTC 字体合集，请先导出单个字体',
        'TTC/OTC collection; export a single face first',
      );
    case 'unknown-font-signature':
      return text('不是 TTF、OTF、WOFF 或 WOFF2 字体', 'Not a TTF, OTF, WOFF or WOFF2 font');
    case 'header-read-failed':
      return text('无法读取文件', 'The file could not be read');
  }
}

export function describeWarning(warning: InspectionWarning, text: Text): string {
  switch (warning.code) {
    case 'woff1-normalized':
      return text(
        'WOFF 已在本地解包，全部字体表保留',
        'WOFF was unpacked locally with all tables preserved',
      );
    case 'large-font':
      return text(
        `解包后 ${formatBytes(warning.normalizedSize)}，移动设备可能内存不足`,
        `${formatBytes(warning.normalizedSize)} unpacked; mobile devices may run out of memory`,
      );
    case 'color-font':
      return text(
        `含彩色字形表（${warning.tables.join(', ')}），请在生成后检查颜色`,
        `Contains color tables (${warning.tables.join(', ')}); check colors after generating`,
      );
    case 'calibration-failed':
      return text(
        '体积校准失败，预估使用经验值',
        'Size calibration failed; estimates use defaults',
      );
  }
}

const ENGLISH_RULES: readonly (readonly [RegExp, string])[] = [
  [/TTC|OTC/u, 'TTC/OTC font collections are not supported. Export a single face first.'],
  [/100 MB/u, 'The font exceeds the 100 MB limit.'],
  [/为空|空字体/u, 'The font file is empty.'],
  [/无法识别字体|格式.*损坏/u, 'The font format is unsupported or the file is damaged.'],
  [/WOFF2/u, 'The WOFF2 data could not be decoded safely.'],
  [/WOFF1/u, 'The WOFF data could not be decoded without losing tables.'],
  [/HarfBuzz/u, 'HarfBuzz could not subset this font.'],
  [/数据加载失败|HTTP/u, 'Data could not be loaded. Check the connection and retry.'],
  [/URL 前缀|http/u, 'The font path must be relative or use http(s).'],
  [/重复/u, 'Two outputs produce the same file name.'],
  [/剪贴板/u, 'Clipboard access is not available.'],
  [/写入本地目录/u, 'This browser cannot write to a local folder. Download the ZIP instead.'],
  [/已被移除/u, 'The font was removed before generation finished.'],
  [/5 MB/u, 'Text files must be 5 MB or smaller.'],
  [/\.txt|文本文件/u, 'Only .txt, .md and .html files can be imported.'],
  [
    /线程|Worker/u,
    'A processing thread stopped unexpectedly. Retry, or close other tabs to free memory.',
  ],
  [/取消/u, 'Cancelled.'],
];

export function localizeEngineError(message: string, text: Text): string {
  const english = text('', 'en') === 'en';
  if (!english) return message;
  return (
    ENGLISH_RULES.find(([pattern]) => pattern.test(message))?.[1] ??
    'Local processing failed. Check the input and try again.'
  );
}
