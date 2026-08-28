import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'tools/unicode/Blocks-17.0.0.txt');
const outputPath = path.join(root, 'src/data/unicode-blocks.json');
const sourceUrl = 'https://www.unicode.org/Public/17.0.0/ucd/Blocks.txt';

function blockId(name) {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const source = await readFile(sourcePath, 'utf8');
const version = /^# Blocks-([\d.]+)\.txt$/m.exec(source)?.[1];
if (version === undefined) throw new Error('无法读取 Unicode Blocks 数据版本');

const blocks = [];
for (const line of source.split(/\r?\n/u)) {
  const match = /^([0-9A-F]+)\.\.([0-9A-F]+);\s*(.+)$/u.exec(line.trim());
  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) continue;

  blocks.push({
    id: blockId(match[3]),
    name: match[3],
    start: Number.parseInt(match[1], 16),
    endInclusive: Number.parseInt(match[2], 16),
  });
}

if (blocks.length < 300) throw new Error(`Unicode 区块数量异常：${String(blocks.length)}`);

let previousEnd = -1;
const ids = new Set();
for (const block of blocks) {
  if (block.start <= previousEnd || block.endInclusive < block.start) {
    throw new Error(`Unicode 区块顺序或范围无效：${block.name}`);
  }
  if (ids.has(block.id)) throw new Error(`Unicode 区块 ID 重复：${block.id}`);
  ids.add(block.id);
  previousEnd = block.endInclusive;
}

const output = `${JSON.stringify({ version, source: sourceUrl, blocks }, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const existing = await readFile(outputPath, 'utf8').catch(() => '');
  if (existing !== output) {
    throw new Error('Unicode 区块数据不是最新生成结果，请运行 pnpm unicode-blocks:build');
  }
  console.log(`Unicode ${version} 区块校验通过：${String(blocks.length)} 个区块。`);
} else {
  await writeFile(outputPath, output, 'utf8');
  console.log(`已生成 Unicode ${version} 区块数据：${String(blocks.length)} 个区块。`);
}
