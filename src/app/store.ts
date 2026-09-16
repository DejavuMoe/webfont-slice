export interface Store<S> {
  get(): S;
  set(updater: (state: S) => S): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(updater) {
      const next = updater(state);
      if (Object.is(next, state)) return;
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** 以参数引用相等为依据的单槽记忆化，配合不可变状态使用。 */
export function memoizeLast<A extends readonly unknown[], R>(
  fn: (...args: A) => R,
): (...args: A) => R {
  let lastArgs: A | null = null;
  let lastResult: R;
  return (...args: A): R => {
    if (
      lastArgs !== null &&
      lastArgs.length === args.length &&
      lastArgs.every((value, index) => Object.is(value, args[index]))
    ) {
      return lastResult;
    }
    lastResult = fn(...args);
    lastArgs = args;
    return lastResult;
  };
}
