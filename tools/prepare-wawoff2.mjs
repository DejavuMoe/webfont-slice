import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedWawoff2Version = '2.0.1';
const wawoff2PackagePath = path.join(root, 'node_modules/wawoff2/package.json');
const sourceDirectory = path.join(root, 'node_modules/wawoff2/build');
const outputDirectory = path.join(root, 'src/generated/wawoff2');
const embeddedWasmPattern =
  /wasmBinaryFile="data:application\/octet-stream;base64,([A-Za-z0-9+/=]+)";/;

const installedWawoff2 = JSON.parse(await readFile(wawoff2PackagePath, 'utf8'));
if (installedWawoff2.version !== expectedWawoff2Version) {
  throw new Error(
    `wawoff2 版本漂移：安全预算仅验证 ${expectedWawoff2Version}，当前安装 ${
      typeof installedWawoff2.version === 'string' ? installedWawoff2.version : '未知版本'
    }`,
  );
}

await mkdir(outputDirectory, { recursive: true });

for (const operation of ['compress', 'decompress']) {
  const sourcePath = path.join(sourceDirectory, `${operation}_binding.js`);
  const source = await readFile(sourcePath, 'utf8');
  const match = embeddedWasmPattern.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`无法从 wawoff2 提取 ${operation} WASM；依赖包结构可能已变化`);
  }

  const wasmFileName = `${operation}-binding.wasm`;
  const binding = source.replace(embeddedWasmPattern, `wasmBinaryFile="${wasmFileName}";`);
  await Promise.all([
    writeFile(
      path.join(outputDirectory, `${operation}-binding.js`),
      `/* 由 tools/prepare-wawoff2.mjs 从 wawoff2 生成，请勿手工编辑。 */\n${binding}`,
      'utf8',
    ),
    writeFile(path.join(outputDirectory, wasmFileName), Buffer.from(match[1], 'base64')),
  ]);
}

console.log('已将 wawoff2 的内嵌 WASM 拆分为可缓存的独立资源。');
