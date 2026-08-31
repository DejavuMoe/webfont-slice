import { describe, expect, it } from 'vitest';
import {
  escapeCssString,
  escapeHtml,
  fontFamilyValue,
  formatFontNumericDescriptor,
  generateFontFaceCss,
  generatePreloadHtml,
  shardUrl,
  validateUrlPrefix,
  type CssFace,
} from './css-gen';

const face: CssFace = {
  family: 'Demo Sans',
  weight: [100, 900],
  style: 'normal',
  shards: [
    { fileName: 'demo-base.woff2', codePoints: [0x20, 0x21, 0x22, 0x41], preload: true },
    { fileName: 'demo-01.woff2', codePoints: [0x4e00, 0x4e01, 0x4e03], preload: false },
  ],
};

describe('CSS 生成', () => {
  it('为每片输出压缩后的 unicode-range 与可变字重范围', () => {
    const css = generateFontFaceCss([face], { fontDisplay: 'swap' });
    expect(css.match(/@font-face/gu)).toHaveLength(2);
    expect(css).toContain('unicode-range: U+0020-0022, U+0041;');
    expect(css).toContain('unicode-range: U+4E00-4E01, U+4E03;');
    expect(css).toContain('font-weight: 100 900;');
    expect(css).toContain('src: url("./fonts/demo-base.woff2") format("woff2");');
    expect(css).not.toContain('ascent-override');
  });

  it('只声明本字体，不生成任何回退字体或度量覆盖', () => {
    const css = generateFontFaceCss([face]);
    expect(css).not.toMatch(/local\(|override|Fallback|sans-serif/u);
    expect(css).toContain(' * font-family: "Demo Sans";');
    expect(css.match(/font-family: "Demo Sans";/gu)).toHaveLength(3);
  });

  it('URL 前缀只接受相对路径与 http(s)', () => {
    expect(validateUrlPrefix(' /assets/fonts/ ')).toBe('/assets/fonts');
    expect(validateUrlPrefix('https://cdn.example.com/f')).toBe('https://cdn.example.com/f');
    expect(validateUrlPrefix('')).toBe('');
    expect(() => validateUrlPrefix('javascript:alert(1)')).toThrow();
    expect(() => validateUrlPrefix('//cdn.example.com')).toThrow();
    expect(() => validateUrlPrefix('a"b')).toThrow();
    expect(() => validateUrlPrefix('a\\b')).toThrow();
    expect(shardUrl('x.woff2', 'https://cdn.example.com')).toBe('https://cdn.example.com/x.woff2');
  });

  it('恶意字族名无法逃逸 CSS 或注释', () => {
    const css = generateFontFaceCss([
      { ...face, family: 'Evil"; } body { color: red } */ </style>' },
    ]);
    expect(css.slice(css.indexOf('*/') + 2)).not.toContain('Evil"');
    expect(css).not.toContain('</style>');
    expect(css.split('/*')).toHaveLength(2);
    const slash = String.fromCharCode(92);
    const nul = String.fromCharCode(0);
    const replacement = String.fromCharCode(0xfffd);
    expect(escapeCssString(`a"b${slash}c${nul}`)).toBe(
      `a${slash}"b${slash}${slash}c${replacement}`,
    );
    expect(escapeHtml('<a href="x">&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('只为 preload 片生成预加载标签', () => {
    const html = generatePreloadHtml([face], '/f');
    expect(html).toBe(
      '<link rel="preload" href="/f/demo-base.woff2" as="font" type="font/woff2" crossorigin>',
    );
  });

  it('数值描述符格式化', () => {
    expect(formatFontNumericDescriptor(400)).toBe('400');
    expect(formatFontNumericDescriptor([75, 100], '%')).toBe('75% 100%');
    expect(fontFamilyValue('A "B"')).toBe('"A \\"B\\""');
  });
});
