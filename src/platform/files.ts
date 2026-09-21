import type { ZipRequest, ZipResponse } from './zip.worker';

/** 在短生命周期 Worker 中打包 ZIP，主线程只接收最终字节。 */
export function buildZip(files: ReadonlyMap<string, Uint8Array | string>): Promise<Uint8Array> {
  const worker = new Worker(new URL('./zip.worker.ts', import.meta.url), {
    type: 'module',
    name: 'webfont-slice-zip',
  });
  return new Promise<Uint8Array>((resolve, reject) => {
    worker.addEventListener('message', (event: MessageEvent<ZipResponse>) => {
      worker.terminate();
      if (event.data.type === 'result') resolve(event.data.zip);
      else reject(new Error(event.data.message));
    });
    worker.addEventListener('error', (event) => {
      worker.terminate();
      reject(new Error(event.message || 'ZIP Worker 运行失败'));
    });
    // 分片字节以结构化克隆复制，界面仍保留原件用于实时预览。
    const request: ZipRequest = { files: [...files.entries()] };
    worker.postMessage(request);
  });
}

export function downloadBytes(fileName: string, bytes: Uint8Array | string, type: string): void {
  const part: BlobPart = typeof bytes === 'string' ? bytes : Uint8Array.from(bytes).buffer;
  const url = URL.createObjectURL(new Blob([part], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export async function copyText(content: string): Promise<void> {
  const clipboard = Reflect.get(navigator, 'clipboard') as Clipboard | undefined;
  if (clipboard === undefined) throw new Error('当前浏览器不支持剪贴板 API');
  await clipboard.writeText(content);
}

interface DirectoryHandle {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{
    createWritable(): Promise<
      WritableStream & { write(data: BlobPart): Promise<void>; close(): Promise<void> }
    >;
  }>;
  readonly name: string;
}

type DirectoryPicker = (options?: { mode?: 'readwrite'; id?: string }) => Promise<DirectoryHandle>;

function directoryPicker(): DirectoryPicker | undefined {
  const picker: unknown = Reflect.get(window, 'showDirectoryPicker');
  return typeof picker === 'function' ? (picker as DirectoryPicker).bind(window) : undefined;
}

export function canWriteDirectory(): boolean {
  return directoryPicker() !== undefined && window.isSecureContext;
}

/**
 * 把输出直接写入用户选择的项目目录（File System Access API，Chromium）。
 * 返回目录名；用户取消时抛出 AbortError。
 */
export async function writeToDirectory(
  files: ReadonlyMap<string, Uint8Array | string>,
): Promise<string> {
  const pick = directoryPicker();
  if (pick === undefined) throw new Error('当前浏览器不支持写入本地目录');
  const root = await pick({ mode: 'readwrite', id: 'webfont-slice-output' });
  for (const [path, content] of files) {
    const segments = path.split('/');
    const fileName = segments.pop() ?? path;
    let directory = root;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    const handle = await directory.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(typeof content === 'string' ? content : Uint8Array.from(content).buffer);
    await writable.close();
  }
  return root.name;
}
