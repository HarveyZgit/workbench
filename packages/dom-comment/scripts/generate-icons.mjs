import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(tag, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(tag), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, paint) {
  const raw = [];
  for (let y = 0; y < size; y += 1) {
    raw.push(0);
    for (let x = 0; x < size; x += 1) {
      raw.push(...paint(x, y, size));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function plus(x, y, s) {
  const m = s / 2;
  const t = Math.max(2, s / 8);
  const on = Math.abs(x - m) < t || Math.abs(y - m) < t;
  return on ? [255, 255, 255, 255] : [37, 99, 235, 255];
}

function xmark(x, y, s) {
  const t = Math.max(2, s / 10);
  const d1 = Math.abs(x - y);
  const d2 = Math.abs(x - (s - 1 - y));
  const on = d1 < t || d2 < t;
  return on ? [255, 255, 255, 255] : [37, 99, 235, 255];
}

const dir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
mkdirSync(dir, { recursive: true });
for (const size of [16, 32]) {
  writeFileSync(path.join(dir, `icon-plus-${size}.png`), png(size, plus));
  writeFileSync(path.join(dir, `icon-x-${size}.png`), png(size, xmark));
}
console.log('icons written', dir);
