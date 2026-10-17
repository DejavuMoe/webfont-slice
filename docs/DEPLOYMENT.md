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

### 自动部署（Woodpecker CI）

`.woodpecker/deploy.yml` 在推送 `master` 时构建并发布到 `/var/www/webfont.zsh.moe`，使用 Woodpecker 3.19 语法。流水线分两步：

1. `build`：在 `node:24.19.0-alpine3.24` 容器中安装 pnpm，运行 `pnpm install --frozen-lockfile`，执行 `pnpm run check` 完整门禁，并通过 `scripts/verify-dist.sh dist` 校验产物（入口 HTML 存在、资源是相对路径、WASM 未被内联、字表数据齐全、首屏 gzip ≤ 300 KiB）。
2. `publish`：在 `alpine:3.24.1` 容器中挂载 `/var/www/webfont.zsh.moe:/deploy`，运行 `scripts/publish-dist.sh dist <release-id>` 原子替换。

发布目录结构与这台服务器上其他站点一致：

```text
/var/www/webfont.zsh.moe/
├─ .deploy.lock                        flock 部署锁
├─ releases/<sha>-<pipeline>-<reruns>/ 每次构建一份不可变副本
└─ html -> releases/...                网站服务器指向的符号链接
```

`html` 先以临时名创建再 `mv -T` 覆盖，`rename(2)` 在同一目录内是原子的，因此请求要么看到旧版本、要么看到新版本，不会读到复制一半的目录。旧版本保留最近 5 份，便于回滚：

```bash
ln -sfn releases/<旧版本> /var/www/webfont.zsh.moe/.html.tmp
mv -T /var/www/webfont.zsh.moe/.html.tmp /var/www/webfont.zsh.moe/html
```

Web 服务器需要跟随符号链接（nginx 默认 `disable_symlinks off`），站点根目录指向 `html/`。

E2E 不在流水线里：它需要带浏览器的完整 Playwright 镜像，会让每次部署多等数分钟。按 AGENTS.md，涉及 UI、Worker、取消、下载或 PWA 的改动在本地跑 `pnpm test:e2e` 即可。

### Web 服务器配置

Web 服务器（如 Nginx、Caddy）的虚拟主机配置直接在服务器上维护，不得提交到代码仓库中以防泄露源站与基础设施细节。

站点根目录指向 `html/` 符号链接（对应当前活动 release），并确保开启符号链接跟随（Nginx 默认 `disable_symlinks off`）。

建议的缓存策略：

| 路径                              | 缓存           | 原因                             |
| --------------------------------- | -------------- | -------------------------------- |
| `/assets/`                        | 一年 immutable | 文件名带内容哈希，改名即改内容   |
| `/charsets/`、`/freq/`            | 5 分钟         | 文件名稳定但发布间会变           |
| `/sw.js`、`/manifest.webmanifest` | `no-cache`     | 陈旧的 Service Worker 会挡住修复 |
| 其余（含 `index.html`）           | `no-cache`     | 入口决定加载哪些哈希文件         |

这是普通静态站，不是 SPA：应用没有客户端路由（只有 `#` 锚点），因此 `try_files` 以 `=404` 结尾。若改成 SPA 回退，拼错的路径会返回首页而不是 404，掩盖坏链。

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
