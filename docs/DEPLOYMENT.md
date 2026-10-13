# 部署

## 部署工具本身

```bash
pnpm install --frozen-lockfile
pnpm build
```

把 `dist/` 上传到任意静态托管即可。Vite `base` 为 `./`，域名根目录和子路径都能直接使用。需要 HTTPS（localhost 除外）才能启用 Service Worker 与离线；字体处理本身不依赖 Service Worker。

- GitHub Pages：把 `dist/` 推到 `gh-pages` 分支，或在仓库的 Pages 设置里选择从 Actions 之外的静态源发布。
- Cloudflare Pages / Netlify：构建命令 `pnpm build`，输出目录 `dist`。
- 不需要 COOP/COEP，也不需要任何服务端接口。

建议给 `.wasm` 返回 `application/wasm` 并开启 Brotli 或 gzip。

## 部署生成的字体

ZIP 结构：

```text
<family>-webfont.zip
├─ fonts.css        @font-face + unicode-range，只声明本字体
├─ fonts/           WOFF2 分片，文件名默认带内容哈希
├─ preload.html     基础片与高概率分片的预加载标签
├─ demo.html        本地服务器打开后可观察分片按需加载
├─ report.json      设置、逐款式缺字、逐片字符数/体积/加载概率
└─ README.md        针对这次生成的部署说明
```

1. 把 `fonts.css` 和 `fonts/` 一起上传，保持相对位置；配置了 URL 前缀时，CSS 直接引用该前缀下的文件，`fonts/` 目录上传到前缀对应的位置。
2. 在 `<head>` 中加入预加载标签和样式表：

   ```html
   <link
     rel="preload"
     href="/assets/fonts/noto-sans-sc-400-base.3f9a0c1e.woff2"
     as="font"
     type="font/woff2"
     crossorigin
   />
   <link rel="stylesheet" href="/assets/fonts.css" />
   ```

   `preload.html` 中已经是这次生成的真实文件名。只预加载它列出的文件，不要预加载全部分片。

3. 使用字体（`fonts.css` 顶部注释与 README 中有这次生成的完整写法）：

   ```css
   body {
     font-family: 'Noto Sans SC';
   }
   ```

   生成的 CSS 只声明本字体，不附加任何回退字体。需要回退时在后面追加你自己的字体栈，例如 `'Noto Sans SC', 'PingFang SC', sans-serif`。

   等宽字体的用法示例指向代码元素；风格集与字符变体（默认保留）在自己的 CSS 里开启：

   ```css
   code,
   kbd,
   samp,
   pre {
     font-family: 'JetBrains Mono', ui-monospace, monospace;
     font-feature-settings: 'zero', 'ss01';
   }
   ```

   `calt` / `liga` 连字默认开启；不需要连字时用 `font-variant-ligatures: none`。

浏览器根据 `unicode-range` 和页面上的实际文字只请求命中的分片。可变字体保留轴时，`@font-face` 声明 `font-weight: 最小 最大`（以及可用的 `font-stretch` 范围），页面可使用范围内任意字重；固定款式时每个实例生成独立规则。

## 缓存

- 带内容哈希的 WOFF2：`Cache-Control: public, max-age=31536000, immutable`。
- `fonts.css`：较短缓存，或给文件名加版本。
- 字体放在跨域 CDN 时，确保返回正确的 `Access-Control-Allow-Origin`；预加载标签保留 `crossorigin`。
- 服务器不需要再压缩 WOFF2（已是 Brotli 压缩），但 `fonts.css` 建议开启压缩。

## 本地检查

```bash
cd 解压目录
python3 -m http.server 8000   # 或任意静态服务器
```

打开 `http://localhost:8000/demo.html`，在文本框中输入内容，页面会列出浏览器实际请求的分片与累计体积。
