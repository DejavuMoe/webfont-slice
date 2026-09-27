import { createContext, useContext } from 'react';
import type { AppController } from '../app/controller';
import type { AppState } from '../app/state';
import type { FontNumericDescriptor, FontStyle } from '../core/css-gen';
import { useStoreSelector } from './use-store';

/** 源字体预览：懒加载的 FontFace，释放时撤销 Blob URL。 */
export interface SourcePreviewHandle {
  readonly family: string;
  load(): Promise<boolean>;
  dispose(): void;
}

export interface ShardPreviewFace {
  readonly weight: FontNumericDescriptor;
  readonly stretch?: FontNumericDescriptor;
  readonly style: FontStyle;
  readonly shards: readonly {
    readonly id: string;
    readonly data: ArrayBuffer;
    readonly codePoints: readonly number[];
  }[];
}

/** 生成结果的真实加载演示：每片一个带 unicode-range 的懒加载 FontFace。 */
export interface ShardPreviewHandle {
  readonly family: string;
  requestedIds(): Set<string>;
  subscribe(listener: () => void): () => void;
  attach(): void;
  detach(): void;
}

export interface PlatformActions {
  readonly createSourcePreview: (file: Blob) => SourcePreviewHandle;
  readonly createShardPreview: (faces: readonly ShardPreviewFace[]) => ShardPreviewHandle;
  readonly copyText: (text: string) => Promise<void>;
  readonly downloadBytes: (fileName: string, bytes: Uint8Array | string, type: string) => void;
  readonly buildZip: (files: ReadonlyMap<string, Uint8Array | string>) => Promise<Uint8Array>;
  readonly canWriteDirectory: () => boolean;
  readonly writeToDirectory: (files: ReadonlyMap<string, Uint8Array | string>) => Promise<string>;
  readonly readTextFile: (file: File) => Promise<string>;
}

export interface AppServices {
  readonly controller: AppController;
  readonly platform: PlatformActions;
}

export const ServicesContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('useServices 必须在 ServicesContext 内使用');
  return services;
}

export function useController(): AppController {
  return useServices().controller;
}

export function useAppState<T>(
  selector: (state: AppState) => T,
  isEqual?: (left: T, right: T) => boolean,
): T {
  return useStoreSelector(useController().store, selector, isEqual);
}
