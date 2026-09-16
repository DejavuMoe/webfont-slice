/**
 * Service Worker 更新的呈现策略。
 *
 * 核心约束：新版本就绪**绝不**自动重载页面。一次 CJK 分包可能跑几十秒，
 * 自动重载会当场销毁用户的全部工作。因此：
 * - 有重型任务在跑时，连提示都不出，只把更新记为待处理；
 * - 任务结束后才提示；
 * - 真正的刷新永远由用户显式点击触发。
 */
export interface AppUpdateState {
  /** Service Worker 已完成预缓存，应用可离线打开。 */
  readonly offlineReady: boolean;
  /** 有新版本已下载并等待激活。 */
  readonly updatePending: boolean;
  /** 用户在本次会话中关闭过提示。 */
  readonly dismissed: boolean;
  /** 当前有体检或分包在运行。 */
  readonly taskActive: boolean;
}

export const INITIAL_APP_UPDATE_STATE: AppUpdateState = {
  offlineReady: false,
  updatePending: false,
  dismissed: false,
  taskActive: false,
};

export type AppUpdateAction =
  | { readonly type: 'offline-ready' }
  | { readonly type: 'update-available' }
  | { readonly type: 'task-active-changed'; readonly active: boolean }
  | { readonly type: 'dismiss' };

export function appUpdateReducer(state: AppUpdateState, action: AppUpdateAction): AppUpdateState {
  if (action.type === 'offline-ready') {
    return state.offlineReady ? state : { ...state, offlineReady: true };
  }
  if (action.type === 'update-available') {
    // 重新出现的新版本要清掉上一次的关闭状态，否则用户永远看不到后续更新。
    return { ...state, updatePending: true, dismissed: false };
  }
  if (action.type === 'task-active-changed') {
    return state.taskActive === action.active ? state : { ...state, taskActive: action.active };
  }
  return state.dismissed ? state : { ...state, dismissed: true };
}

/** 是否现在就向用户展示"有新版本"。 */
export function shouldPromptUpdate(state: AppUpdateState): boolean {
  return state.updatePending && !state.dismissed && !state.taskActive;
}
