import { describe, expect, it, vi } from 'vitest';
import { MAX_FONT_FILE_SIZE } from '../core/font-file';
import { validateFontUploads } from './validate-font-uploads';

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(value.length);
  for (const [index, character] of Array.from(value).entries()) {
    output[index] = character.charCodeAt(0);
  }
  return output;
}

function fontFile(name: string, signature: string, lastModified = 1): File {
  return new File([bytes(signature), bytes('font payload')], name, {
    lastModified,
    type: 'application/octet-stream',
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('validateFontUploads', () => {
  it('只读取前四字节，并按内容接受任意文件名与扩展名不匹配的字体', async () => {
    const renamed = fontFile('renamed.bin', 'wOF2');
    const mismatched = fontFile('actually-otf.ttf', 'OTTO');
    const renamedSlice = vi.spyOn(renamed, 'slice');
    const mismatchedSlice = vi.spyOn(mismatched, 'slice');

    const result = await validateFontUploads([renamed, mismatched], new AbortController().signal);

    expect(result.accepted).toEqual([
      { file: renamed, format: 'woff2' },
      { file: mismatched, format: 'otf' },
    ]);
    expect(result.rejected).toEqual([]);
    expect(renamedSlice).toHaveBeenCalledWith(0, 4);
    expect(mismatchedSlice).toHaveBeenCalledWith(0, 4);
  });

  it('用稳定 code 拒绝伪造扩展名、TTC、空文件与超大文件', async () => {
    const fake = fontFile('fake.ttf', 'NOPE');
    const collection = fontFile('collection.woff2', 'ttcf');
    const empty = new File([], 'empty.otf');
    const large = fontFile('large.data', 'wOF2');
    Object.defineProperty(large, 'size', { value: MAX_FONT_FILE_SIZE + 1 });
    const emptySlice = vi.spyOn(empty, 'slice');
    const largeSlice = vi.spyOn(large, 'slice');

    const result = await validateFontUploads(
      [fake, collection, empty, large],
      new AbortController().signal,
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejected.map(({ file, code }) => [file.name, code])).toEqual([
      ['fake.ttf', 'unknown-font-signature'],
      ['collection.woff2', 'font-collection'],
      ['empty.otf', 'empty-file'],
      ['large.data', 'font-too-large'],
    ]);
    expect(emptySlice).not.toHaveBeenCalled();
    expect(largeSlice).not.toHaveBeenCalled();
  });

  it('混合批次保留原始顺序，单文件读取失败不影响其他合法文件', async () => {
    const first = fontFile('first.data', 'true');
    const unreadable = fontFile('unreadable.ttf', 'wOF2');
    const third = fontFile('third.anything', 'wOFF');
    Object.defineProperty(unreadable, 'slice', {
      value: () => {
        throw new Error('disk read failed');
      },
    });

    const result = await validateFontUploads(
      [first, unreadable, third],
      new AbortController().signal,
    );

    expect(result.accepted.map(({ file }) => file.name)).toEqual(['first.data', 'third.anything']);
    expect(result.rejected.map(({ file, code }) => [file.name, code])).toEqual([
      ['unreadable.ttf', 'header-read-failed'],
    ]);
  });

  it('读取文件头期间取消时整批不产生部分结果', async () => {
    const pendingHeader = deferred<ArrayBuffer>();
    const file = fontFile('pending.bin', 'wOF2');
    Object.defineProperty(file, 'slice', {
      value: () =>
        ({
          arrayBuffer: () => pendingHeader.promise,
        }) as Blob,
    });
    const controller = new AbortController();
    const pending = validateFontUploads([file], controller.signal);

    controller.abort();
    pendingHeader.resolve(bytes('wOF2').buffer);

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
