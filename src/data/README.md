# 运行时静态数据

## `unicode-blocks.json`

- 来源：Unicode Character Database 17.0.0 `Blocks.txt`
- 上游地址：https://www.unicode.org/Public/17.0.0/ucd/Blocks.txt
- 源快照：`tools/unicode/Blocks-17.0.0.txt`
- 生成命令：`pnpm unicode-blocks:build`
- 校验命令：`pnpm unicode-blocks:verify`
- 使用条款：https://www.unicode.org/terms_of_use.html

生成文件包含区块名称和码点边界，不应手工修改。
