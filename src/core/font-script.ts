import { compressRanges, expandRanges, type CodePointRange } from './range-codec';
import { isHanCodePoint } from './text-extract';

/**
 * 字体的文字类型决定"覆盖范围"怎么选。
 *
 * - CJK 字体的体积几乎全部来自汉字（或假名、谚文），范围按标准字表与字频决定；
 * - 西文字体（拉丁正文字体、代码等宽字体、图标字体）不含这些文字，范围按
 *   Unicode 文字区块决定：取字体自身落在这些区块里的字符，不会因为字表里有、
 *   字体里没有而产生成百上千的"缺字"。
 */
export type FontScript = 'cjk' | 'western';

/** 只要带有成规模的汉字、假名或谚文就按 CJK 处理；西文字体通常一个都没有。 */
const CJK_THRESHOLDS = { han: 10, kana: 40, hangul: 100 } as const;

export function classifyFontScript(coverage: Iterable<number>): FontScript {
  let han = 0;
  let kana = 0;
  let hangul = 0;
  for (const codePoint of coverage) {
    if (isHanCodePoint(codePoint)) han += 1;
    else if (codePoint >= 0x3041 && codePoint <= 0x30ff) kana += 1;
    else if (codePoint >= 0xac00 && codePoint <= 0xd7a3) hangul += 1;
    if (
      han >= CJK_THRESHOLDS.han ||
      kana >= CJK_THRESHOLDS.kana ||
      hangul >= CJK_THRESHOLDS.hangul
    ) {
      return 'cjk';
    }
  }
  return 'western';
}

function normalize(...lists: (readonly CodePointRange[])[]): readonly CodePointRange[] {
  return compressRanges(lists.flatMap((ranges) => expandRanges(ranges)));
}

/** 英文与西欧语言：基本拉丁、拉丁-1 补充、常用标点与货币符号（与主流网页字体服务的 latin 子集一致）。 */
const WESTERN_EUROPEAN: readonly CodePointRange[] = [
  [0x0020, 0x007e],
  [0x00a0, 0x00ff],
  [0x0131, 0x0131],
  [0x0152, 0x0153],
  [0x02bb, 0x02bc],
  [0x02c6, 0x02c6],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x0304, 0x0304],
  [0x0308, 0x0308],
  [0x0329, 0x0329],
  [0x2000, 0x206f],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
];

/** 多语言：再加拉丁扩展（含越南文）、希腊文、西里尔文与常用字母式符号。 */
const MULTILINGUAL: readonly CodePointRange[] = [
  [0x0100, 0x024f],
  [0x0250, 0x02ff],
  [0x0300, 0x036f],
  [0x0370, 0x03ff],
  [0x0400, 0x052f],
  [0x1c80, 0x1c8f],
  [0x1e00, 0x1eff],
  [0x1f00, 0x1fff],
  [0x20a0, 0x20cf],
  [0x2100, 0x214f],
  [0x2c60, 0x2c7f],
  [0x2de0, 0x2dff],
  [0xa640, 0xa69f],
  [0xa720, 0xa7ff],
  [0xfb00, 0xfb06],
];

/** 西文字体"西欧"与"多语言"两档对应的区块；"全部"直接取字体全部字符。 */
export const WESTERN_LEVEL_RANGES: Readonly<Record<'common' | 'full', readonly CodePointRange[]>> =
  {
    common: normalize(WESTERN_EUROPEAN),
    full: normalize(WESTERN_EUROPEAN, MULTILINGUAL),
  };
