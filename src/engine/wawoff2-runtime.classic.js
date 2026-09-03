/* global importScripts, self */
'use strict';

(() => {
  let operation;
  let operationName = '';
  let initialized = false;

  function postInitializationError(message) {
    self.postMessage({ type: 'init-error', message });
  }

  function finishInitialization() {
    if (initialized) return;
    const candidate = self.Module?.[operationName];
    if (typeof candidate !== 'function') {
      postInitializationError(`WOFF2 ${operationName} 初始化后未导出操作函数`);
      return;
    }

    operation = candidate;
    initialized = true;
    self.postMessage({ type: 'ready' });
  }

  function initializeRuntime(message) {
    if (
      (message.operationName !== 'compress' && message.operationName !== 'decompress') ||
      typeof message.bindingUrl !== 'string' ||
      typeof message.wasmUrl !== 'string'
    ) {
      postInitializationError('WOFF2 Worker 初始化参数无效');
      return;
    }

    const bindingUrl = new URL(message.bindingUrl, self.location.href);
    const wasmUrl = new URL(message.wasmUrl, self.location.href);
    if (bindingUrl.origin !== self.location.origin || wasmUrl.origin !== self.location.origin) {
      postInitializationError('WOFF2 binding 与 WASM 必须与应用同源');
      return;
    }

    operationName = message.operationName;
    self.Module = {
      locateFile() {
        return wasmUrl.href;
      },
      onRuntimeInitialized: finishInitialization,
      onAbort(reason) {
        postInitializationError(`WOFF2 ${operationName} WASM 初始化失败：${String(reason)}`);
      },
    };

    try {
      importScripts(bindingUrl.href);
      if (self.Module?.calledRun === true) finishInitialization();
    } catch (error) {
      postInitializationError(error instanceof Error ? error.message : '无法载入 WOFF2 binding');
    }
  }

  function runRequest(message) {
    if (!initialized || typeof operation !== 'function') {
      self.postMessage({
        type: 'error',
        requestId: message.requestId,
        message: 'WOFF2 Worker 尚未就绪',
      });
      return;
    }
    if (typeof message.requestId !== 'number' || !(message.data instanceof ArrayBuffer)) return;

    try {
      const result = operation(new Uint8Array(message.data));
      if (result === false) throw new Error(`WOFF2 ${operationName} 失败`);
      const data = Uint8Array.from(result).buffer;
      self.postMessage({ type: 'result', requestId: message.requestId, data }, [data]);
    } catch (error) {
      self.postMessage({
        type: 'error',
        requestId: message.requestId,
        message: error instanceof Error ? error.message : `WOFF2 ${operationName} 失败`,
      });
    }
  }

  self.onmessage = (event) => {
    const message = event.data;
    if (typeof message !== 'object' || message === null) return;
    if (message.type === 'init') initializeRuntime(message);
    else if (message.type === 'run') runRequest(message);
  };
})();
