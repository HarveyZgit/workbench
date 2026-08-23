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

const FOREST = [26, 107, 84, 255];
const PAPER = [244, 245, 243, 255];
const INK = [28, 28, 26, 255];

function inRound(x, y, s, r) {
  const rr = r * r;
  const corners = [
    [r, r],
    [s - 1 - r, r],
    [r, s - 1 - r],
    [s - 1 - r, s - 1 - r],
  ];
  if (x >= r && x <= s - 1 - r) {
    return true;
  }
  if (y >= r && y <= s - 1 - r) {
    return true;
  }
  for (const [cx, cy] of corners) {
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy <= rr) {
      return true;
    }
  }
  return false;
}

function hbar(x, y, x0, x1, y0, t) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y0 + t - 1;
}

function vbar(x, y, y0, y1, x0, t) {
  return y >= y0 && y <= y1 && x >= x0 && x <= x0 + t - 1;
}

function viewfinder(x, y, s) {
  const inset = Math.max(2, Math.round(s * 0.2));
  const len = Math.max(4, Math.round(s * 0.34));
  const t = Math.max(2, Math.round(s * 0.14));
  const hi = s - 1 - inset;
  return (
    hbar(x, y, inset, inset + len - 1, inset, t) ||
    vbar(x, y, inset, inset + len - 1, inset, t) ||
    hbar(x, y, hi - len + 1, hi, inset, t) ||
    vbar(x, y, inset, inset + len - 1, hi - t + 1, t) ||
    hbar(x, y, inset, inset + len - 1, hi - t + 1, t) ||
    vbar(x, y, hi - len + 1, hi, inset, t) ||
    hbar(x, y, hi - len + 1, hi, hi - t + 1, t) ||
    vbar(x, y, hi - len + 1, hi, hi - t + 1, t)
  );
}

function idle(x, y, s) {
  const r = Math.max(2, Math.round(s * 0.18));
  if (!inRound(x, y, s, r)) {
    return [0, 0, 0, 0];
  }
  return viewfinder(x, y, s) ? PAPER : FOREST;
}

function active(x, y, s) {
  const r = Math.max(2, Math.round(s * 0.18));
  if (!inRound(x, y, s, r)) {
    return [0, 0, 0, 0];
  }
  const t = Math.max(2, Math.round(s * 0.12));
  const m = (s - 1) / 2;
  const d1 = Math.abs(x - y);
  const d2 = Math.abs(x - (s - 1 - y));
  const inset = Math.max(3, Math.round(s * 0.22));
  const inside = x >= inset && x <= s - 1 - inset && y >= inset && y <= s - 1 - inset;
  const on = inside && (d1 < t || d2 < t) && Math.abs(x - m) + Math.abs(y - m) < s * 0.72;
  return on ? PAPER : INK;
}

const dir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
mkdirSync(dir, { recursive: true });
for (const size of [16, 32]) {
  writeFileSync(path.join(dir, `icon-plus-${size}.png`), png(size, idle));
  writeFileSync(path.join(dir, `icon-x-${size}.png`), png(size, active));
}
console.log('icons written', dir);
