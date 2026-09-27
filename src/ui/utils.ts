import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export const inputClass =
  'focus-ring h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-fg placeholder:text-fg-3 transition-colors hover:border-fg-3 aria-invalid:border-danger disabled:opacity-50';

export function useCopy(copy: (text: string) => Promise<void>): {
  readonly copied: boolean;
  readonly failed: boolean;
  readonly run: (text: string) => void;
} {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const run = useCallback(
    (text: string) => {
      clearTimeout(timer.current);
      copy(text).then(
        () => {
          setState('copied');
        },
        () => {
          setState('failed');
        },
      );
      timer.current = setTimeout(() => {
        setState('idle');
      }, 1800);
    },
    [copy],
  );
  return { copied: state === 'copied', failed: state === 'failed', run };
}

const supportsMatchMedia = () => typeof window.matchMedia === 'function';

/** 订阅媒体查询；环境不支持（如 jsdom）时返回 fallback。 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!supportsMatchMedia()) return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', listener);
      return () => {
        media.removeEventListener('change', listener);
      };
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (supportsMatchMedia() ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}
