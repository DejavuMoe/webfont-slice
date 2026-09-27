import { createContext, useContext } from 'react';

/** 源字体 ID → 已加载的预览 font-family。 */
export const PreviewContext = createContext<ReadonlyMap<string, string>>(new Map());

export function usePreviewFamily(fontId: string | null | undefined): string | null {
  const families = useContext(PreviewContext);
  return fontId == null ? null : (families.get(fontId) ?? null);
}
