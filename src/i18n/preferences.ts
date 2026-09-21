import { createContext, useContext } from 'react';

export type Locale = 'zh-CN' | 'en';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Preferences {
  readonly locale: Locale;
  readonly theme: ThemeMode;
  readonly resolvedTheme: 'light' | 'dark';
  readonly setLocale: (locale: Locale) => void;
  readonly setTheme: (theme: ThemeMode) => void;
  /** 界面文案就近双语书写：text('中文', 'English')。 */
  readonly text: (chinese: string, english: string) => string;
}

export const PreferencesContext = createContext<Preferences | null>(null);

export function usePreferences(): Preferences {
  const preferences = useContext(PreferencesContext);
  if (preferences === null) throw new Error('usePreferences 必须在 PreferencesProvider 内使用');
  return preferences;
}
