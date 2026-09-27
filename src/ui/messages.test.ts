import { describe, expect, it } from 'vitest';
import { localizeEngineError } from './messages';

const english = (_chinese: string, value: string) => value;
const chinese = (value: string) => value;

describe('引擎错误本地化', () => {
  it('中文界面原样显示', () => {
    expect(localizeEngineError('字体文件为空', chinese)).toBe('字体文件为空');
  });

  it('英文界面把引擎与平台的中文错误映射为具体说明', () => {
    const cases: readonly (readonly [string, RegExp])[] = [
      ['字体文件为空', /empty/u],
      ['字体文件超过 100 MB 上限', /100 MB/u],
      ['字体归一化后超过 100 MB 安全上限', /100 MB/u],
      ['无法识别字体格式或文件已损坏', /unsupported or the file is damaged/u],
      ['暂不支持 TTC/OTC 字体合集，请先导出单个字体', /collections/u],
      ['WOFF2 表目录不完整', /WOFF2/u],
      ['WOFF1 表 glyf 解压失败', /WOFF data/u],
      ['HarfBuzz 子集化失败：oom', /HarfBuzz/u],
      ['数据加载失败（HTTP 404）：./charsets/index.json', /Data could not be loaded/u],
      ['当前浏览器不支持写入本地目录', /local folder/u],
      ['字体已被移除', /removed/u],
      ['自定义文本文件不能超过 5 MB', /5 MB/u],
    ];
    for (const [message, expected] of cases) {
      expect(localizeEngineError(message, english)).toMatch(expected);
    }
  });

  it('未知错误使用通用说明，不泄露中文原文', () => {
    expect(localizeEngineError('某个未知的内部错误', english)).toBe(
      'Local processing failed. Check the input and try again.',
    );
  });
});
