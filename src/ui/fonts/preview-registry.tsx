import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAppState, useServices, type SourcePreviewHandle } from '../app-context';
import { PreviewContext } from './preview-context';

/**
 * 为每个已分析的源字体注册一个懒加载 FontFace（Blob URL），供字体卡片、
 * 分包图提示和缺字列表共用；字体移除时释放。
 */
export function PreviewRegistry({ children }: { readonly children: ReactNode }) {
  const fonts = useAppState((state) => state.fonts);
  const { platform } = useServices();
  const previews = useRef(new Map<string, { file: File; preview: SourcePreviewHandle }>());
  const [families, setFamilies] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    const ready = new Map(
      fonts.filter((font) => font.status === 'ready').map((font) => [font.id, font.file] as const),
    );
    for (const [id, entry] of previews.current) {
      if (ready.get(id) !== entry.file) {
        entry.preview.dispose();
        previews.current.delete(id);
        setFamilies((current) => {
          if (!current.has(id)) return current;
          const next = new Map(current);
          next.delete(id);
          return next;
        });
      }
    }
    for (const [id, file] of ready) {
      if (previews.current.has(id)) continue;
      const preview = platform.createSourcePreview(file);
      previews.current.set(id, { file, preview });
      void preview.load().then((loaded) => {
        if (!loaded || previews.current.get(id)?.preview !== preview) return;
        setFamilies((current) => new Map(current).set(id, preview.family));
      });
    }
  }, [fonts, platform]);

  useEffect(() => {
    const current = previews.current;
    return () => {
      for (const entry of current.values()) entry.preview.dispose();
      current.clear();
    };
  }, []);

  return <PreviewContext value={families}>{children}</PreviewContext>;
}
