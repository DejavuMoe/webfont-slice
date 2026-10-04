// 由 public/app-icon.svg 的几何图形栅格化出 PNG 图标。
//
// 为什么自己画：iOS 主屏和部分 Android 启动器不接受 SVG 图标，必须有 PNG；
// 而引入 sharp/resvg 只为三张静态图标不划算。app-icon.svg 只包含圆角矩形、
// 直角折线路径和圆，可以确定性地扫描线栅格化，输出逐字节可复现。
//
// 用法：node tools/build-app-icons.mjs [--check]

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zlibSync } from 'fflate';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'public', 'app-icon.svg');
const VIEWBOX = 512;
const SUPERSAMPLE = 4;

const OUTPUTS = [
  { file: 'app-icon-192.png', size: 192, safeArea: 1, background: 'rounded' },
  { file: 'app-icon-512.png', size: 512, safeArea: 1, background: 'rounded' },
  // maskable：背景必须满幅（裁切后不能露出透明角），只有内容收进中心 80% 安全区。
  { file: 'app-icon-maskable-512.png', size: 512, safeArea: 0.8, background: 'full' },
  // apple-touch-icon 不支持透明，iOS 自行加圆角，因此满幅且不内缩。
  { file: 'apple-touch-icon.png', size: 180, safeArea: 1, background: 'full' },
];

function parseColor(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** 解析 app-icon.svg 里的三种图元。结构变化时 fail closed。 */
function parseIcon(svg) {
  const rect = /<rect[^>]*width="(\d+)"[^>]*height="(\d+)"[^>]*rx="(\d+)"[^>]*fill="([^"]+)"/u.exec(
    svg,
  );
  const pathMatch = /<path[^>]*d="([^"]+)"[^>]*fill="([^"]+)"/u.exec(svg);
  const circle = /<circle[^>]*cx="(\d+)"[^>]*cy="(\d+)"[^>]*r="(\d+)"[^>]*fill="([^"]+)"/u.exec(
    svg,
  );
  if (rect === null || pathMatch === null || circle === null) {
    throw new Error(
      'app-icon.svg 结构已变化：需要 rect + path + circle 各一个，请同步更新本脚本。',
    );
  }
  return {
    rect: {
      width: Number(rect[1]),
      height: Number(rect[2]),
      radius: Number(rect[3]),
      fill: parseColor(rect[4]),
    },
    glyph: { points: parseRectilinearPath(pathMatch[1]), fill: parseColor(pathMatch[2]) },
    dot: {
      cx: Number(circle[1]),
      cy: Number(circle[2]),
      r: Number(circle[3]),
      fill: parseColor(circle[4]),
    },
  };
}

/** 只支持 M/m/H/h/V/v/Z 的直角折线，正是本图标使用的子集。 */
function parseRectilinearPath(d) {
  const tokens = d.match(/[MmHhVvZz][-\d.,\s]*/gu) ?? [];
  const points = [];
  let x = 0;
  let y = 0;
  for (const token of tokens) {
    const command = token[0];
    const args = token
      .slice(1)
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map(Number);
    if (args.some(Number.isNaN)) {
      throw new Error(`app-icon.svg 路径含不支持的参数：${token}`);
    }
    if (command === 'M' || command === 'm') {
      if (args.length < 2) throw new Error(`app-icon.svg 的 ${command} 缺少坐标：${token}`);
      x = command === 'M' ? args[0] : x + args[0];
      y = command === 'M' ? args[1] : y + args[1];
      points.push([x, y]);
    } else if (command === 'h' || command === 'H') {
      x = command === 'h' ? x + args[0] : args[0];
      points.push([x, y]);
    } else if (command === 'v' || command === 'V') {
      y = command === 'v' ? y + args[0] : args[0];
      points.push([x, y]);
    }
  }
  if (points.length < 4) throw new Error('app-icon.svg 路径点太少，解析可能已失效。');
  return points;
}

function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(px, py, width, height, radius) {
  if (px < 0 || py < 0 || px > width || py > height) return false;
  const cx = Math.min(Math.max(px, radius), width - radius);
  const cy = Math.min(Math.max(py, radius), height - radius);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderIcon(icon, size, safeArea, background) {
  const dim = size * SUPERSAMPLE;
  const accum = new Float64Array(size * size * 4);
  const scale = VIEWBOX / dim;
  const inset = (1 - safeArea) / 2;

  for (let py = 0; py < dim; py += 1) {
    for (let px = 0; px < dim; px += 1) {
      // u/v 是画布坐标；sx/sy 是内容坐标。safeArea < 1 时只有内容内缩，背景仍满幅。
      const u = (px + 0.5) * scale;
      const v = (py + 0.5) * scale;
      const sx = (u - inset * VIEWBOX) / safeArea;
      const sy = (v - inset * VIEWBOX) / safeArea;

      let color = null;
      const onCard =
        background === 'full'
          ? true
          : insideRoundedRect(u, v, icon.rect.width, icon.rect.height, icon.rect.radius);
      if (onCard) color = icon.rect.fill;
      if (color !== null && pointInPolygon(sx, sy, icon.glyph.points)) color = icon.glyph.fill;
      if (color !== null) {
        const dx = sx - icon.dot.cx;
        const dy = sy - icon.dot.cy;
        if (dx * dx + dy * dy <= icon.dot.r * icon.dot.r) color = icon.dot.fill;
      }

      const index = (Math.floor(py / SUPERSAMPLE) * size + Math.floor(px / SUPERSAMPLE)) * 4;
      if (color === null) continue;
      accum[index] += color[0];
      accum[index + 1] += color[1];
      accum[index + 2] += color[2];
      accum[index + 3] += 255;
    }
  }

  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const alpha = accum[i * 4 + 3] / samples;
    pixels[i * 4 + 3] = Math.round(alpha);
    if (alpha === 0) continue;
    // 颜色按已覆盖的样本平均，避免边缘被透明样本拉暗。
    const covered = accum[i * 4 + 3] / 255;
    pixels[i * 4] = Math.round(accum[i * 4] / covered);
    pixels[i * 4 + 1] = Math.round(accum[i * 4 + 1] / covered);
    pixels[i * 4 + 2] = Math.round(accum[i * 4 + 2] / covered);
  }
  return pixels;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

function encodePng(pixels, size) {
  const stride = size * 4;
  const raw = new Uint8Array((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: None，保持输出确定性
    raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

const check = process.argv.includes('--check');
const icon = parseIcon(await readFile(SOURCE, 'utf8'));
let failed = false;

for (const output of OUTPUTS) {
  const pixels = renderIcon(icon, output.size, output.safeArea, output.background);
  const png = encodePng(pixels, output.size);
  const target = path.join(ROOT, 'public', output.file);
  const digest = createHash('sha256').update(png).digest('hex').slice(0, 12);

  if (check) {
    const existing = await readFile(target).catch(() => null);
    if (existing === null || !existing.equals(Buffer.from(png))) {
      console.error(`图标不同步：${output.file}（请运行 pnpm run icons:build）`);
      failed = true;
      continue;
    }
    console.log(`图标校验通过：${output.file} ${String(output.size)}px sha256:${digest}`);
  } else {
    await writeFile(target, png);
    console.log(`已生成 ${output.file} ${String(output.size)}px sha256:${digest}`);
  }
}

if (failed) process.exit(1);
