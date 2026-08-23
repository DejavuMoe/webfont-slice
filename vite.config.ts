import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import packageJson from './package.json' with { type: 'json' };

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // prompt 而非 autoUpdate：新版本绝不能在分包途中自动重载页面。
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['app-icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'WebFont Slice · 网页字体分包',
        short_name: 'WebFont Slice',
        description:
          '在浏览器本地把 CJK、西文与代码字体切成按需加载的 WOFF2 分片，生成可直接部署的 unicode-range CSS',
        theme_color: '#f6f6f4',
        background_color: '#f6f6f4',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        categories: ['developer', 'productivity', 'utilities'],
        start_url: './',
        scope: './',
        lang: 'zh-CN',
        dir: 'ltr',
        icons: [
          {
            src: 'app-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          {
            src: 'app-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'app-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'app-icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{html,js,css,wasm,json,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    assetsInlineLimit: 0,
    target: 'es2022',
    sourcemap: false,
  },
});
