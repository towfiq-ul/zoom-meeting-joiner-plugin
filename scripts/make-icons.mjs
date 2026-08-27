/**
 * Generates icons/icon-{16,48,128}.png — no external deps.
 * Black rounded square with a white camera; the lens is punched out and carries
 * a small "Z". Master vector is icons/logo.svg.
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(outDir, { recursive: true });

// Flip to true for a white square with a black camera (light-toolbar builds).
const INVERT = false;
const FG = INVERT ? [0, 0, 0] : [255, 255, 255]; // the camera + "Z"
const BG = INVERT ? [255, 255, 255] : [0, 0, 0]; // rounded square
const CLEAR = [0, 0, 0, 0];
const SS = 4; // supersampling factor for anti-aliasing

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "latin1");
  const body = Buffer.concat([t, data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = pixels(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = p[0]; raw[o + 1] = p[1]; raw[o + 2] = p[2]; raw[o + 3] = p[3];
    }
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- geometry, all in the normalized 0..1 icon box --------------------
/** Rounded-square coverage: quarter-disc corners + the two mid bands. */
function inRounded(u, v) {
  const r = 0.18;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r || (u >= r && u <= 1 - r) || (v >= r && v <= 1 - r);
}

/** Rounded-rect coverage in 0..1 space. */
function inRoundRect(u, v, x0, y0, x1, y1, rad) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const cx = Math.min(Math.max(u, x0 + rad), x1 - rad);
  const cy = Math.min(Math.max(v, y0 + rad), y1 - rad);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= rad * rad ||
    (u >= x0 + rad && u <= x1 - rad) || (v >= y0 + rad && v <= y1 - rad);
}

/** "Z" glyph coverage inside the box [x0,y0]-[x1,y1]: top bar, diagonal, bottom bar. */
function inZ(u, v, x0, y0, x1, y1) {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false;
  const zu = (u - x0) / (x1 - x0);
  const zv = (v - y0) / (y1 - y0);
  const t = 0.24; // stroke thickness as a fraction of the box
  if (zv < t) return true; // top bar
  if (zv > 1 - t) return true; // bottom bar
  return Math.abs(zu - (1 - zv)) < t * 0.72; // diagonal, top-right -> bottom-left
}

// Camera silhouette + punched-out lens + "Z" in the lens.
const LENS = { cx: 0.5, cy: 0.578, r: 0.203 };
const ZBOX = [0.39, 0.477, 0.61, 0.68];

/** Foreground (camera + "Z") coverage of the mark, in 0..1 space. */
function inMark(u, v) {
  if (inZ(u, v, ZBOX[0], ZBOX[1], ZBOX[2], ZBOX[3])) return true; // Z sits on the dark lens
  const lx = u - LENS.cx, ly = v - LENS.cy;
  if (lx * lx + ly * ly <= LENS.r * LENS.r) return false; // lens is punched out
  const body = inRoundRect(u, v, 0.133, 0.336, 0.867, 0.813, 0.078);
  const bump = inRoundRect(u, v, 0.336, 0.227, 0.555, 0.359, 0.031);
  return body || bump;
}

for (const size of [16, 48, 128]) {
  const buf = png(size, (x, y, s) => {
    let bg = 0, fg = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const u = (x + (i + 0.5) / SS) / s;
        const v = (y + (j + 0.5) / SS) / s;
        if (!inRounded(u, v)) continue;
        bg++;
        if (inMark(u, v)) fg++;
      }
    }
    if (bg === 0) return CLEAR;
    const k = fg / bg; // FG fraction within the opaque part of the pixel
    return [
      Math.round(BG[0] + (FG[0] - BG[0]) * k),
      Math.round(BG[1] + (FG[1] - BG[1]) * k),
      Math.round(BG[2] + (FG[2] - BG[2]) * k),
      Math.round((bg / (SS * SS)) * 255),
    ];
  });
  writeFileSync(join(outDir, `icon-${size}.png`), buf);
  console.log(`icons/icon-${size}.png  (${buf.length} bytes)`);
}
