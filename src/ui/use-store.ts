import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Store } from '../app/store';

/**
 * 订阅 store 的一个切片。选择器每次返回新对象时，用 isEqual 判断是否真正变化，
 * 避免无关更新触发重渲染。
 */
export function useStoreSelector<S, T>(
  store: Store<S>,
  selector: (state: S) => T,
  isEqual: (left: T, right: T) => boolean = Object.is,
): T {
  const cache = useRef<{ state: S; value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const state = store.get();
    const previous = cache.current;
    if (previous !== null && Object.is(previous.state, state)) return previous.value;
    const value = selector(state);
    if (previous !== null && isEqual(previous.value, value)) {
      cache.current = { state, value: previous.value };
      return previous.value;
    }
    cache.current = { state, value };
    return value;
  }, [store, selector, isEqual]);
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function shallowEqual<T>(left: T, right: T): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) =>
    Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}
