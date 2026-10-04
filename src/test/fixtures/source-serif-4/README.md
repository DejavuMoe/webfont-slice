# Source Serif 4 OTF 测试夹具

- 文件：`SourceSerif4-Regular.otf`（CFF/OpenType）及其规范级逐表 WOFF1 封装 `SourceSerif4-Regular.woff`
- 上游：<https://github.com/adobe-fonts/source-serif/tree/release/OTF>
- 许可：SIL Open Font License 1.1，见 `OFL.md`
- `SourceSerif4Variable-TestSubset.ttf`：由上游 `VAR/SourceSerif4Variable-Roman.ttf` 经 HarfBuzz 仅保留拉丁测试字符，仍保留 `fvar/gvar/avar/HVAR/STAT`；用于验证轴检测、保留模式与固定轴静态实例化。
- WOFF1 SHA-256：`69eb7a4dcfe3fede2f0b389897c3804d7abc6b56aab4afd5bcf5475c2a5dce06`；保留 CFF、GDEF/GPOS/GSUB 等全部 14 张表。
- 用途：验证 OTF/CFF、WOFF-CFF、可变字体的体检、HarfBuzz 子集化与 WOFF2 编码链路。
