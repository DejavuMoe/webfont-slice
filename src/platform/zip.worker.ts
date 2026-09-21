/// <reference lib="webworker" />

import { strToU8, zipSync, type Zippable } from 'fflate';

export interface ZipRequest {
  readonly files: readonly (readonly [path: string, content: Uint8Array | string])[];
}

export type ZipResponse =
  | { readonly type: 'result'; readonly zip: Uint8Array }
  | { readonly type: 'error'; readonly message: string };

self.addEventListener('message', (event: MessageEvent<ZipRequest>) => {
  try {
    const tree: Zippable = {};
    for (const [path, content] of event.data.files) {
      // WOFF2 已是 Brotli 压缩，重复压缩只浪费时间；文本文件使用 deflate。
      tree[path] =
        typeof content === 'string' ? [strToU8(content), { level: 6 }] : [content, { level: 0 }];
    }
    const zip = zipSync(tree);
    const response: ZipResponse = { type: 'result', zip };
    self.postMessage(response, { transfer: [zip.buffer] });
  } catch (error: unknown) {
    const response: ZipResponse = {
      type: 'error',
      message: error instanceof Error ? error.message : 'ZIP 打包失败',
    };
    self.postMessage(response);
  }
});
