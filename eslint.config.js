import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { architecturePlugin } from './tools/eslint/architecture-plugin.mjs';
import { loadPlatformTypeNames } from './tools/eslint/platform-type-names.mjs';

const typedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({ ...config, files: ['**/*.{ts,tsx}'] }));

const coreForbiddenPlatformGlobals = [
  ...new Set([
    ...Object.keys(globals.browser),
    ...Object.keys(globals.worker),
    ...loadPlatformTypeNames(),
    'globalThis',
  ]),
].sort();

/**
 * 分层（→ 表示允许依赖）：
 *   App.tsx 组合根 → 全部
 *   ui       → app、core、i18n
 *   app      → core（不依赖任何第三方包，包括 React）
 *   engine   → core、app/ports、generated
 *   platform → core、app/ports
 *   i18n     → core
 *   core     → core、data/unicode-blocks.json（纯 TypeScript，无平台全局）
 */
export default tseslint.config(
  {
    ignores: [
      '.research',
      '.tmp-hb',
      'coverage',
      'dist',
      'node_modules',
      'playwright-report',
      'public/charsets',
      'src/generated',
      'test-results',
      'tools/charset-sources',
    ],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...typedConfigs,
  {
    plugins: {
      architecture: architecturePlugin,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'architecture/no-platform-globals': ['error', { names: coreForbiddenPlatformGlobals }],
      'architecture/source-layers': [
        'error',
        {
          allowedPackages: [],
          allowedSourceFiles: ['data/unicode-blocks.json'],
          allowedSourceRoots: ['core'],
        },
      ],
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { lib: 'never', path: 'never', types: 'never' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MetaProperty[meta.name="import"][property.name="meta"]',
          message: 'src/core 不得读取 import.meta；请从组合根注入配置。',
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.test.{ts,tsx}'],
    rules: {
      'architecture/source-layers': [
        'error',
        {
          allowedPackages: ['vitest'],
          allowedSourceFiles: ['data/unicode-blocks.json'],
          allowedSourceRoots: ['core'],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    ignores: ['src/app/**/*.test.{ts,tsx}'],
    rules: {
      'architecture/source-layers': [
        'error',
        { allowedPackages: [], allowedSourceRoots: ['app', 'core'] },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    ignores: ['src/ui/**/*.test.{ts,tsx}'],
    rules: {
      'architecture/source-layers': [
        'error',
        { allowedSourceRoots: ['app', 'core', 'i18n', 'ui'] },
      ],
    },
  },
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: {
      'architecture/source-layers': [
        'error',
        { allowedSourcePaths: ['app/ports'], allowedSourceRoots: ['core', 'engine', 'generated'] },
      ],
    },
  },
  {
    files: ['src/platform/**/*.{ts,tsx}'],
    rules: {
      'architecture/source-layers': [
        'error',
        { allowedSourcePaths: ['app/ports'], allowedSourceRoots: ['core', 'platform'] },
      ],
    },
  },
  {
    files: ['src/i18n/**/*.{ts,tsx}'],
    rules: {
      'architecture/source-layers': ['error', { allowedSourceRoots: ['core', 'i18n'] }],
    },
  },
  {
    files: ['*.config.ts', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
