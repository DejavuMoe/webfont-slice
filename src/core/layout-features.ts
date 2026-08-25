/**
 * 子集化时保留的 OpenType 布局特性。
 *
 * HarfBuzz 默认保留 ccmp/locl/kern/liga/calt/mark 等基础排版与各文字的整形特性
 * （见 hb-subset-input.cc 的 default_layout_features）。这里列出默认会被裁掉、
 * 但网页 CSS 常用的特性：
 *
 * - CJK：`palt`/`vpal`（标点挤压，`font-feature-settings` 与 `text-spacing-trim` 常用）；
 * - 数字：`font-variant-numeric` 依赖的 tnum/pnum/lnum/onum/zero 等；
 * - 代码与西文字体：`ss01`–`ss20` 风格集与 `cv01`–`cv99` 字符变体，
 *   代码字体用它们切换 0/O 写法、连字风格与斜体手写体（连字本身靠默认保留的 calt/liga）。
 *
 * 只有字体自己定义了这些特性才会占用字节。不保留 `dlig`：CJK 字体用它把拉丁缩写
 * 映射到方块组合字形，Noto Sans SC 的基础片会因此从 14 KB 变成 28 KB。
 */
const NUMBERED = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${String(index + 1).padStart(2, '0')}`);

export const WEB_LAYOUT_FEATURES: readonly string[] = [
  'palt',
  'vpal',
  'halt',
  'vhal',
  'chws',
  'vchw',
  'kern',
  'vkrn',
  'locl',
  'vert',
  'vrt2',
  'tnum',
  'pnum',
  'lnum',
  'onum',
  'zero',
  'case',
  'sups',
  'subs',
  'ordn',
  ...NUMBERED('ss', 20),
  ...NUMBERED('cv', 99),
];

/** HarfBuzz 子集化默认保留的特性（与上面的追加集合一起决定输出里还剩哪些）。 */
const HARFBUZZ_DEFAULT_FEATURES: readonly string[] = [
  'rvrn',
  'ccmp',
  'liga',
  'locl',
  'mark',
  'mkmk',
  'rlig',
  'frac',
  'numr',
  'dnom',
  'calt',
  'clig',
  'curs',
  'kern',
  'rclt',
  'valt',
  'vert',
  'vkrn',
  'vpal',
  'vrt2',
  'ltra',
  'ltrm',
  'rtla',
  'rtlm',
  'rand',
  'jalt',
  'chws',
  'vchw',
  'halt',
  'vhal',
  'init',
  'medi',
  'fina',
  'isol',
  'med2',
  'fin2',
  'fin3',
  'cswh',
  'mset',
  'stch',
  'ljmo',
  'vjmo',
  'tjmo',
  'abvs',
  'blws',
  'abvm',
  'blwm',
  'nukt',
  'akhn',
  'rphf',
  'rkrf',
  'pref',
  'blwf',
  'half',
  'abvf',
  'pstf',
  'cfar',
  'vatu',
  'cjct',
  'pres',
  'psts',
  'haln',
  'dist',
];

const DEFAULTS = new Set(HARFBUZZ_DEFAULT_FEATURES);
const WEB = new Set(WEB_LAYOUT_FEATURES);

/** 某个特性是否会留在生成的分片里；`webFeatures` 对应"保留排版特性"开关。 */
export function isRetainedLayoutFeature(tag: string, webFeatures: boolean): boolean {
  return DEFAULTS.has(tag) || (webFeatures && WEB.has(tag));
}
