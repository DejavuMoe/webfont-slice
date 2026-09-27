import { useRef } from 'react';

export const FONT_ACCEPT = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';

export function useFilePicker(onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      accept={FONT_ACCEPT}
      className="sr-only"
      multiple
      onChange={(event) => {
        const files = [...(event.target.files ?? [])];
        event.target.value = '';
        if (files.length > 0) onFiles(files);
      }}
      ref={input}
      tabIndex={-1}
      type="file"
      aria-hidden="true"
    />
  );
  return {
    element,
    open: () => {
      input.current?.click();
    },
  };
}
