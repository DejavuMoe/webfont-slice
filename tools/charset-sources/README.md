# 字符集构建源快照

这些文件只在 `pnpm charsets:build` 时使用。生成结果位于 `public/charsets/`。所有预设 JSON 都记录公开 HTTP(S) 来源、固定版本/处理说明和许可；运行时不引用仓库内 Markdown。校验脚本同时检查来源 URL 与官方/公布字数。

| 目录                              | 内容                                                       | 上游与固定版本                                                                          | 许可/说明                                |
| --------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `tgh-2013/`                       | 《通用规范汉字表》8105 字及分级                            | `chenny/General-Chinese-Characters-Table-Pro@579687e`，依据国家语委 2013 官方文本数字化 | 上游 MIT；原标准链接见生成数据           |
| `modern-1988/`                    | 《现代汉语常用字表》3500、《现代汉语通用字表》7000         | `quanh/chinese-char-dict@97b5d4f`                                                       | 标准事实数据；上游明确标注为旧版留存     |
| `taiwan/`                         | 台湾教育部常用國字 4808、次常用國字 6341                   | `cjkvi/cjkvi-tables@096c255`                                                            | 标准事实数据；运行时注明为社区数字化快照 |
| `hong-kong/common-graphemes.json` | 香港《常用字字形表》4762 条（含同序异体）                  | `leonsilicon/list-of-graphemes-of-commonly-used-chinese-characters@07f649a`             | 上游 MIT；依据香港教育学院 2000 修订本   |
| `hong-kong/HKSCS2016.tsv`         | HKSCS-2016                                                 | `yawnoc/hkscs-2016@1c5900f`，原始 JSON 来自 data.gov.hk                                 | 香港政府开放数据；上游为格式转换         |
| `mappings/CP936.TXT`              | GB 2312/GBK Unicode 映射                                   | Unicode Consortium Microsoft CP936 mapping                                              | Unicode Terms of Use                     |
| `mappings/CP950.TXT`              | Big5 Unicode 映射                                          | Unicode Consortium Microsoft CP950 mapping                                              | Unicode Terms of Use                     |
| `opencc/`                         | 简繁字符映射（STCharacters、TWVariants），用于派生繁体字频 | `BYVoid/OpenCC@178f05d`                                                                 | Apache-2.0，许可见目录内 LICENSE         |

注意：字表是字符集合预设，不代表字体字形符合相应地区的标准字形。最终字形由用户上传字体决定。
