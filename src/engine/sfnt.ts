/**
 * 最小 SFNT 读写工具：表目录、字形体积、垂直度量、布局特性与 name 表精简。
 *
 * 只读取做决策所需的少量字段；任何结构异常都退回安全默认值，
 * 不让估算类信息阻断正常的子集化流程。
 */

export interface SfntTable {
  readonly tag: string;
  readonly offset: number;
  readonly length: number;
}

export function readTableDirectory(data: ArrayBuffer | Uint8Array): Map<string, SfntTable> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = new Map<string, SfntTable>();
  if (bytes.byteLength < 12) return tables;
  const count = view.getUint16(4);
  if (12 + count * 16 > bytes.byteLength) return tables;
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(
      bytes[record] ?? 32,
      bytes[record + 1] ?? 32,
      bytes[record + 2] ?? 32,
      bytes[record + 3] ?? 32,
    );
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length <= bytes.byteLength) tables.set(tag, { tag, offset, length });
  }
  return tables;
}

function tableView(
  bytes: Uint8Array,
  table: SfntTable | undefined,
  minimum: number,
): DataView | null {
  if (table === undefined || table.length < minimum) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + table.offset, table.length);
}

/** GSUB/GPOS 中声明的布局特性标签（去重、排序）。 */
export function readLayoutFeatures(data: ArrayBuffer): string[] {
  const bytes = new Uint8Array(data);
  const tables = readTableDirectory(bytes);
  const features = new Set<string>();
  for (const tag of ['GSUB', 'GPOS']) {
    const view = tableView(bytes, tables.get(tag), 10);
    if (view === null) continue;
    const listOffset = view.getUint16(6);
    if (listOffset + 2 > view.byteLength) continue;
    const count = view.getUint16(listOffset);
    for (let index = 0; index < count; index += 1) {
      const record = listOffset + 2 + index * 6;
      if (record + 6 > view.byteLength) break;
      features.add(
        String.fromCharCode(
          view.getUint8(record),
          view.getUint8(record + 1),
          view.getUint8(record + 2),
          view.getUint8(record + 3),
        ),
      );
    }
  }
  return [...features].filter((tag) => /^[\x20-\x7e]{4}$/u.test(tag)).sort();
}

/**
 * 按 glyph id 读取 hmtx 中的步进宽度；`numberOfHMetrics` 之后的字形沿用最后一项。
 * 表缺失或结构异常时返回 null。
 */
export function readAdvanceWidths(data: ArrayBuffer, glyphIds: readonly number[]): number[] | null {
  const bytes = new Uint8Array(data);
  const tables = readTableDirectory(bytes);
  const hhea = tableView(bytes, tables.get('hhea'), 36);
  if (hhea === null) return null;
  const metrics = hhea.getUint16(34);
  const hmtx = tableView(bytes, tables.get('hmtx'), metrics * 4);
  if (hmtx === null || metrics === 0) return null;
  return glyphIds.map((glyphId) => hmtx.getUint16(Math.min(glyphId, metrics - 1) * 4));
}

// ---------------------------------------------------------------------------
// 字形体积
// ---------------------------------------------------------------------------

export interface GlyphSizes {
  /** 按 glyph id 索引的轮廓字节。 */
  readonly outline: Uint32Array;
  /** 按 glyph id 索引的 gvar 字节；非可变 TrueType 为 null。 */
  readonly variation: Uint32Array | null;
  readonly flavor: 'glyf' | 'cff' | 'cff2' | 'unknown';
}

function readLocaSizes(bytes: Uint8Array, tables: Map<string, SfntTable>): Uint32Array | null {
  const head = tableView(bytes, tables.get('head'), 54);
  const maxp = tableView(bytes, tables.get('maxp'), 6);
  const loca = tables.get('loca');
  if (head === null || maxp === null || loca === undefined) return null;
  const glyphCount = maxp.getUint16(4);
  const longFormat = head.getInt16(50) === 1;
  const entrySize = longFormat ? 4 : 2;
  if (loca.length < (glyphCount + 1) * entrySize) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + loca.offset, loca.length);
  const sizes = new Uint32Array(glyphCount);
  let previous = longFormat ? view.getUint32(0) : view.getUint16(0) * 2;
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    const next = longFormat ? view.getUint32((glyph + 1) * 4) : view.getUint16((glyph + 1) * 2) * 2;
    sizes[glyph] = next >= previous ? next - previous : 0;
    previous = next;
  }
  return sizes;
}

function readGvarSizes(
  bytes: Uint8Array,
  tables: Map<string, SfntTable>,
  glyphCount: number,
): Uint32Array | null {
  const view = tableView(bytes, tables.get('gvar'), 20);
  if (view === null) return null;
  const count = view.getUint16(12);
  const longOffsets = (view.getUint16(14) & 1) === 1;
  const entrySize = longOffsets ? 4 : 2;
  if (20 + (count + 1) * entrySize > view.byteLength) return null;
  const sizes = new Uint32Array(Math.max(glyphCount, count));
  const read = (index: number) =>
    longOffsets ? view.getUint32(20 + index * 4) : view.getUint16(20 + index * 2) * 2;
  let previous = read(0);
  for (let glyph = 0; glyph < count; glyph += 1) {
    const next = read(glyph + 1);
    sizes[glyph] = next >= previous ? next - previous : 0;
    previous = next;
  }
  return sizes;
}

class CffReader {
  readonly view: DataView;
  constructor(view: DataView) {
    this.view = view;
  }

  /** 读取 INDEX 的每项长度；CFF2 的 count 为 32 位。 */
  indexSizes(offset: number, wideCount: boolean): { sizes: Uint32Array; end: number } | null {
    const view = this.view;
    const countBytes = wideCount ? 4 : 2;
    if (offset + countBytes > view.byteLength) return null;
    const count = wideCount ? view.getUint32(offset) : view.getUint16(offset);
    if (count === 0) return { sizes: new Uint32Array(0), end: offset + countBytes };
    const offSize = view.getUint8(offset + countBytes);
    if (offSize < 1 || offSize > 4) return null;
    const offsetsStart = offset + countBytes + 1;
    const dataStart = offsetsStart + (count + 1) * offSize - 1;
    if (dataStart > view.byteLength) return null;
    const readOffset = (index: number) => {
      let value = 0;
      for (let byte = 0; byte < offSize; byte += 1) {
        value = value * 256 + view.getUint8(offsetsStart + index * offSize + byte);
      }
      return value;
    };
    const sizes = new Uint32Array(count);
    let previous = readOffset(0);
    for (let index = 0; index < count; index += 1) {
      const next = readOffset(index + 1);
      sizes[index] = next >= previous ? next - previous : 0;
      previous = next;
    }
    return { sizes, end: dataStart + previous };
  }

  indexFirstItem(offset: number): { start: number; end: number } | null {
    const view = this.view;
    if (offset + 3 > view.byteLength) return null;
    const count = view.getUint16(offset);
    if (count === 0) return null;
    const offSize = view.getUint8(offset + 2);
    const offsetsStart = offset + 3;
    const dataStart = offsetsStart + (count + 1) * offSize - 1;
    const readOffset = (index: number) => {
      let value = 0;
      for (let byte = 0; byte < offSize; byte += 1) {
        value = value * 256 + view.getUint8(offsetsStart + index * offSize + byte);
      }
      return value;
    };
    return { start: dataStart + readOffset(0), end: dataStart + readOffset(1) };
  }

  /** 在 DICT 中查找单操作数运算符（如 17 = CharStrings）。 */
  dictOperand(start: number, end: number, operator: number): number | null {
    const view = this.view;
    const operands: number[] = [];
    let cursor = start;
    while (cursor < end && cursor < view.byteLength) {
      const b0 = view.getUint8(cursor);
      if (b0 <= 21) {
        let op = b0;
        cursor += 1;
        if (b0 === 12) {
          op = 1200 + view.getUint8(cursor);
          cursor += 1;
        }
        if (op === operator) return operands.at(-1) ?? null;
        operands.length = 0;
      } else if (b0 === 28) {
        operands.push(view.getInt16(cursor + 1));
        cursor += 3;
      } else if (b0 === 29) {
        operands.push(view.getInt32(cursor + 1));
        cursor += 5;
      } else if (b0 === 30) {
        cursor += 1;
        while (cursor < end) {
          const nibbles = view.getUint8(cursor);
          cursor += 1;
          if ((nibbles & 0x0f) === 0x0f || nibbles >> 4 === 0x0f) break;
        }
        operands.push(0);
      } else if (b0 >= 32 && b0 <= 246) {
        operands.push(b0 - 139);
        cursor += 1;
      } else if (b0 >= 247 && b0 <= 250) {
        operands.push((b0 - 247) * 256 + view.getUint8(cursor + 1) + 108);
        cursor += 2;
      } else if (b0 >= 251 && b0 <= 254) {
        operands.push(-(b0 - 251) * 256 - view.getUint8(cursor + 1) - 108);
        cursor += 2;
      } else {
        cursor += 1;
      }
    }
    return null;
  }
}

function readCffSizes(bytes: Uint8Array, table: SfntTable): Uint32Array | null {
  const reader = new CffReader(
    new DataView(bytes.buffer, bytes.byteOffset + table.offset, table.length),
  );
  const view = reader.view;
  if (view.byteLength < 4) return null;
  const headerSize = view.getUint8(2);
  const names = reader.indexSizes(headerSize, false);
  if (names === null) return null;
  const topDict = reader.indexFirstItem(names.end);
  if (topDict === null) return null;
  const charStrings = reader.dictOperand(topDict.start, topDict.end, 17);
  if (charStrings === null || charStrings <= 0) return null;
  return reader.indexSizes(charStrings, false)?.sizes ?? null;
}

function readCff2Sizes(bytes: Uint8Array, table: SfntTable): Uint32Array | null {
  const reader = new CffReader(
    new DataView(bytes.buffer, bytes.byteOffset + table.offset, table.length),
  );
  const view = reader.view;
  if (view.byteLength < 5) return null;
  const headerSize = view.getUint8(2);
  const topDictLength = view.getUint16(3);
  const charStrings = reader.dictOperand(headerSize, headerSize + topDictLength, 17);
  if (charStrings === null || charStrings <= 0) return null;
  return reader.indexSizes(charStrings, true)?.sizes ?? null;
}

export function readGlyphSizes(data: ArrayBuffer): GlyphSizes {
  const bytes = new Uint8Array(data);
  const tables = readTableDirectory(bytes);
  try {
    const glyf = readLocaSizes(bytes, tables);
    if (glyf !== null) {
      return {
        outline: glyf,
        variation: readGvarSizes(bytes, tables, glyf.length),
        flavor: 'glyf',
      };
    }
    const cff2 = tables.get('CFF2');
    if (cff2 !== undefined) {
      const sizes = readCff2Sizes(bytes, cff2);
      if (sizes !== null) return { outline: sizes, variation: null, flavor: 'cff2' };
    }
    const cff = tables.get('CFF ');
    if (cff !== undefined) {
      const sizes = readCffSizes(bytes, cff);
      if (sizes !== null) return { outline: sizes, variation: null, flavor: 'cff' };
    }
  } catch {
    // 估算信息缺失时使用平均值，不影响子集化。
  }
  return { outline: new Uint32Array(0), variation: null, flavor: 'unknown' };
}

// ---------------------------------------------------------------------------
// name 表精简
// ---------------------------------------------------------------------------

/** 保留：版权、字族/子族、唯一标识、全名、版本、PostScript 名、商标、许可描述与 URL、排版字族。 */
const KEEP_NAME_IDS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 16, 17, 21, 22, 25]);

interface NameRecord {
  readonly platformId: number;
  readonly encodingId: number;
  readonly languageId: number;
  readonly nameId: number;
  readonly bytes: Uint8Array;
}

function isWindowsUnicode(record: NameRecord): boolean {
  return record.platformId === 3 && (record.encodingId === 1 || record.encodingId === 10);
}

function readNameRecords(bytes: Uint8Array, table: SfntTable): NameRecord[] | null {
  const view = tableView(bytes, table, 6);
  if (view === null) return null;
  const count = view.getUint16(2);
  const storage = view.getUint16(4);
  if (6 + count * 12 > view.byteLength) return null;
  const records: NameRecord[] = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 12;
    const length = view.getUint16(offset + 8);
    const stringOffset = storage + view.getUint16(offset + 10);
    if (stringOffset + length > view.byteLength) return null;
    records.push({
      platformId: view.getUint16(offset),
      encodingId: view.getUint16(offset + 2),
      languageId: view.getUint16(offset + 4),
      nameId: view.getUint16(offset + 6),
      bytes: bytes.subarray(table.offset + stringOffset, table.offset + stringOffset + length),
    });
  }
  return records;
}

function buildNameTable(records: readonly NameRecord[]): Uint8Array {
  const sorted = [...records].sort(
    (left, right) =>
      left.platformId - right.platformId ||
      left.encodingId - right.encodingId ||
      left.languageId - right.languageId ||
      left.nameId - right.nameId,
  );
  const storageParts: Uint8Array[] = [];
  const offsets: number[] = [];
  let storageLength = 0;
  for (const record of sorted) {
    offsets.push(storageLength);
    storageParts.push(record.bytes);
    storageLength += record.bytes.byteLength;
  }
  const headerLength = 6 + sorted.length * 12;
  const output = new Uint8Array(headerLength + storageLength);
  const view = new DataView(output.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, sorted.length);
  view.setUint16(4, headerLength);
  sorted.forEach((record, index) => {
    const offset = 6 + index * 12;
    view.setUint16(offset, record.platformId);
    view.setUint16(offset + 2, record.encodingId);
    view.setUint16(offset + 4, record.languageId);
    view.setUint16(offset + 6, record.nameId);
    view.setUint16(offset + 8, record.bytes.byteLength);
    view.setUint16(offset + 10, offsets[index] ?? 0);
  });
  let cursor = headerLength;
  for (const part of storageParts) {
    output.set(part, cursor);
    cursor += part.byteLength;
  }
  return output;
}

function calculateChecksum(bytes: Uint8Array): number {
  let sum = 0;
  const padded = bytes.byteLength + ((4 - (bytes.byteLength % 4)) % 4);
  for (let offset = 0; offset < padded; offset += 4) {
    const value =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    sum = (sum + (value >>> 0)) >>> 0;
  }
  return sum;
}

/** 以给定的表集合重建 SFNT，并重新计算校验和。 */
export function rebuildSfnt(
  sfntVersion: number,
  tables: ReadonlyMap<string, Uint8Array>,
): Uint8Array {
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  let entrySelector = 0;
  while (2 ** (entrySelector + 1) <= count) entrySelector += 1;
  const searchRange = 2 ** entrySelector * 16;
  const headerLength = 12 + count * 16;
  let total = headerLength;
  for (const tag of tags) total += ((tables.get(tag)?.byteLength ?? 0) + 3) & ~3;

  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  view.setUint32(0, sfntVersion);
  view.setUint16(4, count);
  view.setUint16(6, searchRange);
  view.setUint16(8, entrySelector);
  view.setUint16(10, count * 16 - searchRange);

  let offset = headerLength;
  let headOffset = -1;
  tags.forEach((tag, index) => {
    const data = tables.get(tag) ?? new Uint8Array(0);
    const table = tag === 'head' ? Uint8Array.from(data) : data;
    if (tag === 'head' && table.byteLength >= 12) {
      new DataView(table.buffer).setUint32(8, 0);
      headOffset = offset;
    }
    const record = 12 + index * 16;
    for (let byte = 0; byte < 4; byte += 1) output[record + byte] = tag.charCodeAt(byte);
    view.setUint32(record + 4, calculateChecksum(table));
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, table.byteLength);
    output.set(table, offset);
    offset += (table.byteLength + 3) & ~3;
  });
  if (headOffset >= 0) {
    view.setUint32(headOffset + 8, (0xb1b0afba - calculateChecksum(output)) >>> 0);
  }
  return output;
}

/**
 * 只保留 Windows Unicode 平台的英文（缺失时回退到该 nameID 的首条 Windows 记录）
 * 必要 name 记录。CJK 字体常带多语言、多平台的重复名称，每片都会重复携带。
 * 版权（0）与许可描述/URL（13/14）始终保留。任何异常都返回原字体。
 */
export function trimNameTable(sfnt: Uint8Array): Uint8Array {
  try {
    const tables = readTableDirectory(sfnt);
    const name = tables.get('name');
    if (name === undefined) return sfnt;
    const records = readNameRecords(sfnt, name);
    if (records === null) return sfnt;
    const windows = records.filter(isWindowsUnicode);
    if (!windows.some((record) => record.nameId === 1)) return sfnt;

    const kept: NameRecord[] = [];
    for (const nameId of KEEP_NAME_IDS) {
      const candidates = windows.filter((record) => record.nameId === nameId);
      const english = candidates.filter((record) => record.languageId === 0x409);
      kept.push(...(english.length > 0 ? english : candidates.slice(0, 1)));
    }
    const trimmed = buildNameTable(kept);
    if (trimmed.byteLength >= name.length) return sfnt;

    const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
    const rebuilt = new Map<string, Uint8Array>();
    for (const table of tables.values()) {
      rebuilt.set(
        table.tag,
        table.tag === 'name' ? trimmed : sfnt.subarray(table.offset, table.offset + table.length),
      );
    }
    return rebuildSfnt(view.getUint32(0), rebuilt);
  } catch {
    return sfnt;
  }
}

/** 小写表标签集合（保留空格，如 'cff '），用于断言与特征判断。 */
export function collectSfntTableTags(data: ArrayBuffer | Uint8Array): Set<string> {
  return new Set([...readTableDirectory(data).keys()].map((tag) => tag.toLowerCase()));
}
