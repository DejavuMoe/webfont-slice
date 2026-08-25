export type FontFormat = 'ttf' | 'otf' | 'woff' | 'woff2' | 'ttc' | 'unknown';
export type ProcessableFontFormat = Exclude<FontFormat, 'ttc' | 'unknown'>;

const PROCESSABLE_FONT_FORMATS: ReadonlySet<FontFormat> = new Set(['ttf', 'otf', 'woff', 'woff2']);

function tag(bytes: Uint8Array): string {
  if (bytes.byteLength < 4) return '';
  return String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
}

export function detectFontFormat(data: ArrayBuffer | Uint8Array): FontFormat {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength < 4) return 'unknown';

  const signature = tag(bytes);
  if (signature === 'OTTO') return 'otf';
  if (signature === 'wOFF') return 'woff';
  if (signature === 'wOF2') return 'woff2';
  if (signature === 'ttcf') return 'ttc';
  if (signature === 'true' || signature === 'typ1') return 'ttf';

  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return 'ttf';
  }

  return 'unknown';
}

export function isProcessableFontFormat(format: FontFormat): format is ProcessableFontFormat {
  return PROCESSABLE_FONT_FORMATS.has(format);
}

export function formatLabel(format: FontFormat): string {
  const labels: Readonly<Record<FontFormat, string>> = {
    ttf: 'TrueType (TTF)',
    otf: 'OpenType (OTF)',
    woff: 'Web Open Font Format (WOFF)',
    woff2: 'Web Open Font Format 2 (WOFF2)',
    ttc: 'TrueType Collection (TTC)',
    unknown: '未知格式',
  };
  return labels[format];
}
