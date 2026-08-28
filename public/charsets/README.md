# 字符集运行时数据

本目录包含由 `tools/build-charsets/index.mjs` 生成的 31 份字符集 JSON 和索引，请勿手工编辑。

每份预设记录：

- 标准名称与码点范围；
- 可从静态站直接打开的绝对 HTTP(S) 来源；
- 固定版本或处理说明；
- 许可摘要。

仓库内 Markdown 只用于开发文档，不会作为浏览器界面的来源链接。

```bash
pnpm charsets:build
pnpm charsets:verify
```
