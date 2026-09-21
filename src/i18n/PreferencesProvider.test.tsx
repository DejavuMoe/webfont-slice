// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreferencesProvider } from './PreferencesProvider';
import { usePreferences, type Preferences } from './preferences';

function PreferenceProbe({ onValue }: { readonly onValue: (preferences: Preferences) => void }) {
  const preferences = usePreferences();

  useEffect(() => {
    onValue(preferences);
  }, [onValue, preferences]);

  return (
    <>
      <button
        onClick={() => {
          preferences.setTheme('light');
        }}
        type="button"
      >
        set theme
      </button>
      <button
        onClick={() => {
          preferences.setLocale('en');
        }}
        type="button"
      >
        set locale
      </button>
    </>
  );
}

function latestPreference(
  onValue: ReturnType<typeof vi.fn<(preferences: Preferences) => void>>,
): Preferences {
  const value = onValue.mock.calls.at(-1)?.[0];
  if (value === undefined) throw new Error('偏好探针尚未收到上下文');
  return value;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('PreferencesProvider', () => {
  it('翻译函数仅在 locale 改变时更新 identity', async () => {
    localStorage.setItem('webfont-slice:locale', 'zh-CN');
    const onValue = vi.fn<(preferences: Preferences) => void>();
    render(
      <PreferencesProvider>
        <PreferenceProbe onValue={onValue} />
      </PreferencesProvider>,
    );

    await waitFor(() => {
      expect(onValue).toHaveBeenCalled();
    });
    const initialText = latestPreference(onValue).text;

    fireEvent.click(screen.getByRole('button', { name: 'set theme' }));
    await waitFor(() => {
      expect(latestPreference(onValue).theme).toBe('light');
    });
    expect(latestPreference(onValue).text).toBe(initialText);

    fireEvent.click(screen.getByRole('button', { name: 'set locale' }));
    await waitFor(() => {
      expect(latestPreference(onValue).locale).toBe('en');
    });
    expect(latestPreference(onValue).text).not.toBe(initialText);
    expect(latestPreference(onValue).text('中文', 'English')).toBe('English');
  });

  it('没有保存偏好时按浏览器语言选择界面语言', async () => {
    const onValue = vi.fn<(preferences: Preferences) => void>();
    render(
      <PreferencesProvider>
        <PreferenceProbe onValue={onValue} />
      </PreferencesProvider>,
    );
    await waitFor(() => {
      expect(onValue).toHaveBeenCalled();
    });
    const expected = navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    expect(latestPreference(onValue).locale).toBe(expected);
    expect(document.documentElement.dataset.theme).toMatch(/^(light|dark)$/u);
  });
});
