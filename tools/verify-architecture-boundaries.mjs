import path from 'node:path';
import { ESLint } from 'eslint';

const projectRoot = path.resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: projectRoot });

const rejectedProbes = [
  {
    name: 'deep ui to engine',
    file: 'src/ui/result/ResultSection.tsx',
    code: `import type { EngineWorkerApi } from '../../../../../../engine/protocol';
export type Probe = EngineWorkerApi;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'noncanonical ui to engine',
    file: 'src/ui/result/ResultSection.tsx',
    code: `import type { EngineWorkerApi } from '../../ui/result/../../engine/protocol';
export type Probe = EngineWorkerApi;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'ui to platform',
    file: 'src/ui/result/ResultSection.tsx',
    code: `import { copyText } from '../../platform/files';
export const probe = copyText;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'engine to app controller',
    file: 'src/engine/pool.ts',
    code: `import { AppController } from '../app/controller';
export const probe = AppController;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'dynamic ui to engine',
    file: 'src/ui/result/ResultSection.tsx',
    code: `void import('../../engine/pool');`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'type import ui to engine',
    file: 'src/ui/result/ResultSection.tsx',
    code: `export type Probe = import('../../engine/protocol').EngineWorkerApi;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'require ui to platform',
    file: 'src/ui/result/ResultSection.tsx',
    code: `export const probe = require('../../platform/files');`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'core globalThis fetch',
    file: 'src/core/font-file.ts',
    code: `export const probe = globalThis.fetch;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core localStorage',
    file: 'src/core/font-file.ts',
    code: `export const probe = localStorage;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core DOM type reference',
    file: 'src/core/font-file.ts',
    code: `export type Probe = Window;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core DOM property type',
    file: 'src/core/font-file.ts',
    code: `export interface Probe { file: File }`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core Worker heritage type',
    file: 'src/core/font-file.ts',
    code: `export interface Probe extends Worker {}`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core platform type query',
    file: 'src/core/font-file.ts',
    code: `export type Probe = typeof localStorage;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core qualified global type',
    file: 'src/core/font-file.ts',
    code: `export type Probe = globalThis.File;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core DOM-only BodyInit type',
    file: 'src/core/font-file.ts',
    code: `export type Probe = BodyInit;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core DOM-only EventListener type',
    file: 'src/core/font-file.ts',
    code: `export type Probe = EventListener;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core DOM-only RequestInfo type',
    file: 'src/core/font-file.ts',
    code: `export type Probe = RequestInfo;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core Worker-only Transferable type',
    file: 'src/core/font-file.ts',
    code: `export type Probe = Transferable;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core Worker-only global scope type',
    file: 'src/core/font-file.ts',
    code: `export type Probe = ServiceWorkerGlobalScope;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core triple-slash types reference',
    file: 'src/core/font-file.ts',
    code: `/// <reference types="vitest/globals" />
export type Probe = typeof describe;`,
    ruleId: '@typescript-eslint/triple-slash-reference',
  },
  {
    name: 'core triple-slash lib reference',
    file: 'src/core/font-file.ts',
    code: `/// <reference lib="dom" />
export type Probe = BodyInit;`,
    ruleId: '@typescript-eslint/triple-slash-reference',
  },
  {
    name: 'core triple-slash path reference',
    file: 'src/core/font-file.ts',
    code: `/// <reference path="./font-format.ts" />
export type Probe = string;`,
    ruleId: '@typescript-eslint/triple-slash-reference',
  },
  {
    name: 'core ambient localStorage value shadow',
    file: 'src/core/font-file.ts',
    code: `declare const localStorage: { getItem(key: string): string | null };
export const probe = localStorage;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core ambient fetch function shadow',
    file: 'src/core/font-file.ts',
    code: `declare function fetch(): Promise<void>;
export const probe = fetch;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core ambient File class shadow',
    file: 'src/core/font-file.ts',
    code: `declare class File {}
export const probe = File;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core merged interface and ambient File shadow',
    file: 'src/core/font-file.ts',
    code: `interface File { readonly name: string }
declare const File: { readonly prototype: File };
export const probe = File;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core merged type and ambient localStorage shadow',
    file: 'src/core/font-file.ts',
    code: `type localStorage = string;
declare const localStorage: localStorage;
export const probe = localStorage;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core merged interface and ambient fetch shadow',
    file: 'src/core/font-file.ts',
    code: `interface fetch { readonly marker: true }
declare function fetch(): Promise<void>;
export const probe = fetch;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core merged interface and exported ambient window shadow',
    file: 'src/core/font-file.ts',
    code: `interface window { readonly name: string }
export declare const window: window;
export const probe = window;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core merged declaration-level type import and ambient File shadow',
    file: 'src/core/font-file.ts',
    code: `import type { FontFormat as File } from './font-format';
declare const File: { readonly kind: File };
export const probe = File;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core merged inline type import and ambient File shadow',
    file: 'src/core/font-file.ts',
    code: `import { type FontFormat as File } from './font-format';
declare const File: { readonly kind: File };
export const probe = File;`,
    ruleId: 'architecture/no-platform-globals',
  },
  {
    name: 'core production Vitest package',
    file: 'src/core/font-file.ts',
    code: `import { describe } from 'vitest';
export const probe = describe;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'core React package',
    file: 'src/core/font-file.ts',
    code: `import { createElement } from 'react';
export const probe = createElement;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'core i18n React proxy',
    file: 'src/core/font-file.ts',
    code: `import type { Locale } from '../i18n/preferences';
export type Probe = Locale;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'core executable data bridge',
    file: 'src/core/font-file.ts',
    code: `import { browserFetch } from '../data/bridge';
export const probe = browserFetch;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'core to third-party package',
    file: 'src/core/output-package.ts',
    code: `import { zipSync } from 'fflate';
export const probe = zipSync;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'app to React',
    file: 'src/app/store.ts',
    code: `import { useState } from 'react';
export const probe = useState;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'app to engine implementation',
    file: 'src/app/controller.ts',
    code: `import { EnginePool } from '../engine/pool';
export const probe = EnginePool;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'app to platform implementation',
    file: 'src/app/controller.ts',
    code: `import { buildZip } from '../platform/files';
export const probe = buildZip;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'platform to app state',
    file: 'src/platform/data.ts',
    code: `import type { AppState } from '../app/state';
export type Probe = AppState;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'platform to engine',
    file: 'src/platform/files.ts',
    code: `import { EnginePool } from '../engine/pool';
export const probe = EnginePool;`,
    ruleId: 'architecture/source-layers',
  },
  {
    name: 'engine to ui',
    file: 'src/engine/pool.ts',
    code: `import { cx } from '../ui/utils';
export const probe = cx;`,
    ruleId: 'architecture/source-layers',
  },
];

const allowedProbes = [
  {
    name: 'ui to core',
    file: 'src/ui/result/ResultSection.tsx',
    code: `import type { FontInspection } from '../../core/font-inspection';
export type Probe = FontInspection;`,
  },
  {
    name: 'engine to app port',
    file: 'src/engine/pool.ts',
    code: `import type { FontEngine } from '../app/ports';
export type Probe = FontEngine;`,
  },
  {
    name: 'core to core',
    file: 'src/core/output-package.ts',
    code: `import { compressRanges } from './range-codec';
export const probe = compressRanges;`,
  },
  {
    name: 'ui to app',
    file: 'src/ui/result/ResultSection.tsx',
    code: `import type { AppState } from '../../app/state';
export type Probe = AppState;`,
  },
  {
    name: 'platform to app port',
    file: 'src/platform/data.ts',
    code: `import type { CharsetRepository } from '../app/ports';
export type Probe = CharsetRepository;`,
  },
  {
    name: 'core test to Vitest package',
    file: 'src/core/font-file.test.ts',
    code: `import { describe } from 'vitest';
export const probe = describe;`,
  },
  {
    name: 'core local type shadowing platform name',
    file: 'src/core/font-file.ts',
    code: `interface File { readonly bytes: Uint8Array }
export type Probe = File;`,
  },
  {
    name: 'core emitted value shadowing platform name',
    file: 'src/core/font-file.ts',
    code: `class File { readonly bytes = new Uint8Array() }
export const probe = File;`,
  },
  {
    name: 'core emitted value import shadowing platform name',
    file: 'src/core/font-file.ts',
    code: `import { detectFontFormat as File } from './font-format';
export const probe = File;`,
  },
  {
    name: 'core to exact generated data file',
    file: 'src/core/unicode-coverage.ts',
    code: `import unicodeBlocks from '../data/unicode-blocks.json';
export const probe = unicodeBlocks;`,
  },
];

async function lintProbe(probe) {
  const [result] = await eslint.lintText(probe.code, {
    filePath: path.resolve(projectRoot, probe.file),
  });
  return result?.messages ?? [];
}

for (const probe of rejectedProbes) {
  const messages = await lintProbe(probe);
  if (!messages.some((message) => message.ruleId === probe.ruleId && message.severity === 2)) {
    throw new Error(
      `架构拒绝探针未按预期失败：${probe.name}\n${messages
        .map((message) => `${message.ruleId ?? 'parser'}: ${message.message}`)
        .join('\n')}`,
    );
  }
}

for (const probe of allowedProbes) {
  const messages = (await lintProbe(probe)).filter((message) => message.severity === 2);
  if (messages.length > 0) {
    throw new Error(
      `架构允许探针被误拦截：${probe.name}\n${messages
        .map((message) => `${message.ruleId ?? 'parser'}: ${message.message}`)
        .join('\n')}`,
    );
  }
}

console.log(
  `架构边界探针通过：${String(rejectedProbes.length)} 项拒绝、${String(allowedProbes.length)} 项允许。`,
);
