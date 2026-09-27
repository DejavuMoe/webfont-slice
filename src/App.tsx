import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { appUpdateReducer, INITIAL_APP_UPDATE_STATE, shouldPromptUpdate } from './app/app-update';
import { AppController } from './app/controller';
import { initialState, loadPersistedSettings, type AppState } from './app/state';
import { createStore, type Store } from './app/store';
import { maxEngineThreads, type DeviceProfile } from './core/threads';
import { EnginePool } from './engine/pool';
import { createCharsetRepository } from './platform/data';
import { ShardPreviewSet, SourcePreview, validateWoff2 } from './platform/font-faces';
import {
  buildZip,
  canWriteDirectory,
  copyText,
  downloadBytes,
  writeToDirectory,
} from './platform/files';
import { createBrowserServiceWorker, type ServiceWorkerPort } from './platform/service-worker';
import { readCustomTextFile } from './platform/text-import';
import { ServicesContext, type AppServices } from './ui/app-context';
import { Shell } from './ui/Shell';

function deviceProfile(): DeviceProfile {
  const memory: unknown = Reflect.get(navigator, 'deviceMemory');
  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    ...(typeof memory === 'number' ? { deviceMemory: memory } : {}),
  };
}

function useLazy<T>(create: () => T): T {
  return useState(create)[0];
}

/** 唯一的组合根：创建 store、引擎线程池、数据仓库与控制器，并注入平台能力。 */
export function App() {
  const services = useLazy<AppServices>(() => {
    const device = deviceProfile();
    const store: Store<AppState> = createStore(initialState(loadPersistedSettings()));
    const controller = new AppController({
      store,
      engine: new EnginePool({ maxWorkers: maxEngineThreads(device) }),
      repository: createCharsetRepository(),
      device,
      validateShard: validateWoff2,
      appVersion: __APP_VERSION__,
    });
    return {
      controller,
      platform: {
        createSourcePreview: (file) => new SourcePreview(file),
        createShardPreview: (faces) => new ShardPreviewSet(faces),
        copyText,
        downloadBytes,
        buildZip,
        canWriteDirectory,
        writeToDirectory,
        readTextFile: readCustomTextFile,
      },
    };
  });

  useEffect(() => services.controller.start(), [services]);

  const serviceWorker = useRef<ServiceWorkerPort | null>(null);
  const [update, dispatchUpdate] = useReducer(appUpdateReducer, INITIAL_APP_UPDATE_STATE);
  const [online, setOnline] = useState(() => navigator.onLine);

  // Service Worker 只推送状态；何时提示由 appUpdateReducer 决定，刷新永远由用户触发。
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void createBrowserServiceWorker()
      .then((worker) => {
        if (cancelled) return;
        serviceWorker.current = worker;
        unsubscribe = worker.subscribe((status) => {
          if (status.offlineReady) dispatchUpdate({ type: 'offline-ready' });
          if (status.updateAvailable) dispatchUpdate({ type: 'update-available' });
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(
    () =>
      services.controller.store.subscribe(() => {
        const state = services.controller.store.get();
        const busy =
          state.run.phase === 'running' ||
          state.fonts.some((font) => font.status === 'inspecting' || font.status === 'queued');
        dispatchUpdate({ type: 'task-active-changed', active: busy });
      }),
    [services],
  );

  useEffect(() => {
    const updateOnline = () => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  const shellStatus = useMemo(
    () => ({ online, offlineReady: update.offlineReady }),
    [online, update.offlineReady],
  );

  return (
    <ServicesContext value={services}>
      <Shell
        onApplyUpdate={() => {
          void serviceWorker.current?.applyUpdate();
        }}
        onDismissUpdate={() => {
          dispatchUpdate({ type: 'dismiss' });
        }}
        showUpdate={shouldPromptUpdate(update)}
        status={shellStatus}
      />
    </ServicesContext>
  );
}
