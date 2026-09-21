import {
  formatFontNumericDescriptor,
  type FontNumericDescriptor,
  type FontStyle,
} from '../core/css-gen';
import { compressRanges, formatUnicodeRanges } from '../core/range-codec';

let sequence = 0;

function uniqueFamily(prefix: string): string {
  sequence += 1;
  return `${prefix}-${String(sequence)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 用浏览器自身的字体解析器（Chrome/Firefox 为 OTS）校验一个 WOFF2 分片。
 * ArrayBuffer 源会被立即解析；校验结束后不留在 document.fonts 中。
 */
export async function validateWoff2(data: ArrayBuffer): Promise<void> {
  const face = new FontFace(uniqueFamily('wfs-validate'), data.slice(0));
  await face.load();
}

/** 源字体预览：用 Blob URL 懒加载，释放时撤销。 */
export class SourcePreview {
  readonly family: string;
  readonly #url: string;
  readonly #face: FontFace;
  #disposed = false;

  constructor(file: Blob) {
    this.family = uniqueFamily('wfs-source');
    this.#url = URL.createObjectURL(file);
    this.#face = new FontFace(this.family, `url("${this.#url}")`, { display: 'block' });
    document.fonts.add(this.#face);
  }

  load(): Promise<boolean> {
    return this.#face.load().then(
      () => !this.#disposed,
      () => false,
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    document.fonts.delete(this.#face);
    URL.revokeObjectURL(this.#url);
  }
}

export interface PreviewShard {
  readonly id: string;
  readonly data: ArrayBuffer;
  readonly codePoints: readonly number[];
}

export interface PreviewFace {
  readonly weight: FontNumericDescriptor;
  readonly stretch?: FontNumericDescriptor;
  readonly style: FontStyle;
  readonly shards: readonly PreviewShard[];
}

/**
 * 生成结果的真实加载演示：每个分片注册为带 unicode-range 的懒加载 FontFace，
 * 与部署后的 CSS 行为一致——浏览器只下载当前文字真正需要的分片。
 */
export class ShardPreviewSet {
  readonly family: string;
  readonly #faces: readonly PreviewFace[];
  #entries: { readonly id: string; readonly face: FontFace; readonly url: string }[] = [];
  readonly #listeners = new Set<() => void>();
  readonly #onLoading = () => {
    for (const listener of this.#listeners) listener();
  };

  /** 构造不产生副作用；attach() 注册 FontFace，detach() 全部撤销，可重复调用。 */
  constructor(faces: readonly PreviewFace[]) {
    this.family = uniqueFamily('wfs-result');
    this.#faces = faces;
  }

  attach(): void {
    if (this.#entries.length > 0) return;
    for (const face of this.#faces) {
      for (const shard of face.shards) {
        const url = URL.createObjectURL(new Blob([shard.data], { type: 'font/woff2' }));
        const fontFace = new FontFace(this.family, `url("${url}") format("woff2")`, {
          weight: formatFontNumericDescriptor(face.weight),
          ...(face.stretch === undefined
            ? {}
            : { stretch: formatFontNumericDescriptor(face.stretch, '%') }),
          style: face.style,
          display: 'swap',
          unicodeRange: formatUnicodeRanges(compressRanges(shard.codePoints)),
        });
        document.fonts.add(fontFace);
        this.#entries.push({ id: shard.id, face: fontFace, url });
      }
    }
    document.fonts.addEventListener('loading', this.#onLoading);
    document.fonts.addEventListener('loadingdone', this.#onLoading);
    document.fonts.addEventListener('loadingerror', this.#onLoading);
    this.#onLoading();
  }

  /** 已被浏览器请求（加载中或已加载）的分片 ID。 */
  requestedIds(): Set<string> {
    return new Set(
      this.#entries
        .filter((entry) => entry.face.status === 'loaded' || entry.face.status === 'loading')
        .map((entry) => entry.id),
    );
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  detach(): void {
    document.fonts.removeEventListener('loading', this.#onLoading);
    document.fonts.removeEventListener('loadingdone', this.#onLoading);
    document.fonts.removeEventListener('loadingerror', this.#onLoading);
    for (const entry of this.#entries) {
      document.fonts.delete(entry.face);
      URL.revokeObjectURL(entry.url);
    }
    this.#entries = [];
    this.#onLoading();
  }
}
