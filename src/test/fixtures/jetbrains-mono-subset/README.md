# JetBrains Mono 测试子集

- 上游字体：JetBrains Mono 2.304 `fonts/ttf/JetBrainsMono-Regular.ttf`（SHA-256 `a0bf60ef0f83c5ed4d7a75d45838548b1f6873372dfac88f71804491898d138f`）
- 上游地址：<https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304>
- 许可：SIL Open Font License 1.1（无保留字体名称），全文见 `OFL.txt`
- `JetBrainsMono-TestSubset.ttf` SHA-256：`bd08c9697b907eb4d9d01062409d1650bd83251e126785154ea41f51b69de4a9`

由上游 TTF 使用 hb-subset-wasm 0.4.0（HarfBuzz 10.4）生成，去掉 hinting，保留 ASCII、拉丁-1、基本希腊与西里尔字母、常用标点、箭头与制表符，以及 `calt`、`liga`、`zero`、`ss01`、`ss02`、`cv01`、`cv02` 特性，用于测试等宽代码字体的识别、按文字分片与特性保留。子集化不改变许可。

该字体只用于自动化测试，不会进入生产站点资源。
