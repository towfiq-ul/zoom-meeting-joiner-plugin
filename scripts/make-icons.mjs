/**
 * Generates icons/icon-{16,48,128}.png — no external deps.
 * Black rounded square with a white "Z". Master vector is icons/logo.svg.
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(outDir, { recursive: true });

// Flip to true for a white square with a black "Z" (light-toolbar builds).
const INVERT = false;
const FG = INVERT ? [0, 0, 0] : [255, 255, 255]; // the "Z"
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

// ---- geometry, all in a normalized 0..1 box -----------------------------
/** Rounded-square coverage: quarter-disc corners + the two mid bands. */
function inRounded(u, v) {
  const r = 0.18;
  const cx = Math.min(Math.max(u, r), 1 - r);
  const cy = Math.min(Math.max(v, r), 1 - r);
  const dx = u - cx, dy = v - cy;
  return dx * dx + dy * dy <= r * r || (u >= r && u <= 1 - r) || (v >= r && v <= 1 - r);
}

/** "Z" glyph in its own normalized 0..1 box: top bar, bottom bar, diagonal. */
function inZ(u, v) {
  const t = 0.16; // stroke thickness
  if (v < t) return u >= 0 && u <= 1; // top bar
  if (v > 1 - t) return u >= 0 && u <= 1; // bottom bar
  return Math.abs(u - (1 - v)) < t * 0.9; // diagonal, top-right -> bottom-left
}

const PAD = 0.24; // inset of the Z box within the square
const INNER = 1 - PAD * 2;

for (const size of [16, 48, 128]) {
  const buf = png(size, (x, y, s) => {
    let bg = 0, fg = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const u = (x + (i + 0.5) / SS) / s;
        const v = (y + (j + 0.5) / SS) / s;
        if (!inRounded(u, v)) continue;
        bg++;
        const zu = (u - PAD) / INNER;
        const zv = (v - PAD) / INNER;
        if (zu >= 0 && zu <= 1 && zv >= 0 && zv <= 1 && inZ(zu, zv)) fg++;
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
