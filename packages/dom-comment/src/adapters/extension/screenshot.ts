import type { CropRect } from './messages.js';

const MAX_CSS = 1600;

export function dataUrlPngBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    return dataUrl;
  }
  return dataUrl.slice(comma + 1);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrlPngBase64(dataUrl));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 8192;
  let bin = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    bin += String.fromCharCode(...bytes.subarray(i, end));
  }
  return btoa(bin);
}

export async function cropVisiblePng(dataUrl: string, crop: CropRect, dpr: number): Promise<string> {
  const bytes = dataUrlToBytes(dataUrl);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' });
  const bmp = await createImageBitmap(blob);
  const scale = dpr > 0 ? dpr : 1;
  let cssW = Math.max(1, crop.width);
  let cssH = Math.max(1, crop.height);
  const longest = Math.max(cssW, cssH);
  if (longest > MAX_CSS) {
    const shrink = MAX_CSS / longest;
    cssW *= shrink;
    cssH *= shrink;
  }
  const sx = Math.max(0, Math.min(bmp.width - 1, crop.x * scale));
  const sy = Math.max(0, Math.min(bmp.height - 1, crop.y * scale));
  const sw = Math.max(1, Math.min(bmp.width - sx, crop.width * scale));
  const sh = Math.max(1, Math.min(bmp.height - sy, crop.height * scale));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(cssW * scale)),
    Math.max(1, Math.round(cssH * scale)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return dataUrlPngBase64(dataUrl);
  }
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const out = await canvas.convertToBlob({ type: 'image/png' });
  return bytesToBase64(new Uint8Array(await out.arrayBuffer()));
}
