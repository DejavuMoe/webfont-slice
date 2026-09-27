import { formatBytes } from '../core/font-file';
import type { Locale } from '../i18n/preferences';

export { formatBytes };

export function formatNumber(value: number, locale: Locale): string {
  return Math.round(value).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN');
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDuration(ms: number, locale: Locale): string {
  if (ms < 1000)
    return locale === 'en' ? `${String(Math.round(ms))} ms` : `${String(Math.round(ms))} 毫秒`;
  const seconds = ms / 1000;
  if (seconds < 60) return locale === 'en' ? `${seconds.toFixed(1)} s` : `${seconds.toFixed(1)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return locale === 'en'
    ? `${String(minutes)} min ${String(rest)} s`
    : `${String(minutes)} 分 ${String(rest)} 秒`;
}

export function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

export function charFor(codePoint: number): string {
  return String.fromCodePoint(codePoint);
}
