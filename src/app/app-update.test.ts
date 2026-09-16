import { describe, expect, it } from 'vitest';
import {
  appUpdateReducer,
  INITIAL_APP_UPDATE_STATE,
  shouldPromptUpdate,
  type AppUpdateAction,
  type AppUpdateState,
} from './app-update';

function apply(actions: readonly AppUpdateAction[]): AppUpdateState {
  return actions.reduce(appUpdateReducer, INITIAL_APP_UPDATE_STATE);
}

describe('appUpdateReducer', () => {
  it('初始状态不提示更新', () => {
    expect(shouldPromptUpdate(INITIAL_APP_UPDATE_STATE)).toBe(false);
  });

  it('空闲时收到新版本会提示', () => {
    expect(shouldPromptUpdate(apply([{ type: 'update-available' }]))).toBe(true);
  });

  it('重型任务运行中绝不提示更新', () => {
    const state = apply([
      { type: 'task-active-changed', active: true },
      { type: 'update-available' },
    ]);

    expect(state.updatePending).toBe(true);
    expect(shouldPromptUpdate(state)).toBe(false);
  });

  it('任务结束后才提示此前挂起的更新', () => {
    const state = apply([
      { type: 'task-active-changed', active: true },
      { type: 'update-available' },
      { type: 'task-active-changed', active: false },
    ]);

    expect(shouldPromptUpdate(state)).toBe(true);
  });

  it('用户关闭后不再提示同一次更新', () => {
    const state = apply([{ type: 'update-available' }, { type: 'dismiss' }]);

    expect(shouldPromptUpdate(state)).toBe(false);
    expect(state.updatePending).toBe(true);
  });

  it('关闭后再次出现新版本会重新提示', () => {
    const state = apply([
      { type: 'update-available' },
      { type: 'dismiss' },
      { type: 'update-available' },
    ]);

    expect(shouldPromptUpdate(state)).toBe(true);
  });

  it('离线就绪与更新提示互不影响', () => {
    const state = apply([{ type: 'offline-ready' }]);

    expect(state.offlineReady).toBe(true);
    expect(shouldPromptUpdate(state)).toBe(false);
  });

  it('重复动作返回同一引用，避免无谓重渲染', () => {
    const ready = apply([{ type: 'offline-ready' }]);
    expect(appUpdateReducer(ready, { type: 'offline-ready' })).toBe(ready);

    const busy = apply([{ type: 'task-active-changed', active: true }]);
    expect(appUpdateReducer(busy, { type: 'task-active-changed', active: true })).toBe(busy);

    const dismissed = apply([{ type: 'update-available' }, { type: 'dismiss' }]);
    expect(appUpdateReducer(dismissed, { type: 'dismiss' })).toBe(dismissed);
  });
});
