import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { PreferencesContext, type Locale, type Preferences, type ThemeMode } from './preferences';

function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 禁用持久化不应阻止本地字体处理。
  }
}

function initialLocale(): Locale {
  const stored = readPreference('webfont-slice:locale');
  if (stored === 'en' || stored === 'zh-CN') return stored;
  return typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('zh')
    ? 'en'
    : 'zh-CN';
}

function storedTheme(): ThemeMode {
  const value = readPreference('webfont-slice:theme');
  return value === 'light' || value === 'dark' ? value : 'system';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function PreferencesProvider({ children }: { readonly children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [theme, setTheme] = useState<ThemeMode>(storedTheme);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      setSystemDark(query.matches);
    };
    query.addEventListener('change', update);
    return () => {
      query.removeEventListener('change', update);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    writePreference('webfont-slice:locale', locale);
  }, [locale]);

  useEffect(() => {
    writePreference('webfont-slice:theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    // 先屏蔽过渡再换主题，双 rAF 后恢复：新配色在同一帧直接生效，没有插值中间态。
    root.dataset.themeSwitching = '';
    root.dataset.theme = resolvedTheme;
    const meta = document.querySelector('meta[name="theme-color"]:not([media])');
    meta?.setAttribute('content', resolvedTheme === 'dark' ? '#0b0b0c' : '#f6f6f4');
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        delete root.dataset.themeSwitching;
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      delete root.dataset.themeSwitching;
    };
  }, [resolvedTheme]);

  const text = useCallback(
    (chinese: string, english: string) => (locale === 'en' ? english : chinese),
    [locale],
  );
  const value = useMemo<Preferences>(
    () => ({ locale, theme, resolvedTheme, setLocale, setTheme, text }),
    [locale, resolvedTheme, text, theme],
  );

  return <PreferencesContext value={value}>{children}</PreferencesContext>;
}
