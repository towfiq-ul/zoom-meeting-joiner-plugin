/**
 * Generates Chrome Web Store / Edge Add-ons listing images from the *real*
 * popup layout constants (popup.css), rendered with @napi-rs/canvas — no
 * screenshot tooling, no real invite images (see LISTING.md / PRIVACY.md).
 *
 * Output (all 24-bit RGB, no alpha channel — store upload forms reject PNGs
 * with an alpha channel):
 *   assets/store/screenshot-1-empty.png     1280x800
 *   assets/store/screenshot-2-scanning.png  1280x800
 *   assets/store/screenshot-3-results.png   1280x800
 *   assets/store/screenshot-4-crop.png      1280x800
 *   assets/store/screenshot-5-confirm.png   1280x800
 *   assets/store/promo-tile-440x280.png     440x280
 *   assets/store/marquee-1400x560.png       1400x560
 *
 * Run: node scripts/store-assets.mjs  (or `make store-assets`)
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets", "store");

// ---- palette, matches popup.css :root ------------------------------------
const C = {
  bg: "#ffffff",
  fg: "#1a1a1a",
  muted: "#6b7280",
  border: "#d1d5db",
  accent: "#2d8cff",
  accentFg: "#ffffff",
  ok: "#047857",
  page: "#eef2f7", // "desktop" behind the mockup
  band: "#e7f0fe", // caption banner
};

// ---- manual 24-bit (no alpha) PNG encoder, mirrors scripts/make-icons.mjs -
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
/** Encode RGBA canvas pixels as a truecolor (no-alpha) PNG. */
function encodeOpaquePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolor, no alpha
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = y * stride + 1 + x * 3;
      raw[di] = rgba[si];
      raw[di + 1] = rgba[si + 1];
      raw[di + 2] = rgba[si + 2];
      // rgba[si + 3] (alpha) is intentionally dropped
    }
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
async function saveOpaquePng(canvas, path) {
  const ctx = canvas.getContext("2d");
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const buf = encodeOpaquePng(canvas.width, canvas.height, data);
  await writeFile(path, buf);
  console.log(`Generated ${path.replace(ROOT + "/", "")} (${buf.length} bytes, no alpha)`);
}

// ---- shared drawing helpers ------------------------------------------------
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
function input(ctx, x, y, w, h, value, opts = {}) {
  rr(ctx, x, y, w, h, 6);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = opts.focus ? C.accent : C.border;
  ctx.lineWidth = opts.focus ? 2 : 1;
  ctx.stroke();
  ctx.fillStyle = value ? C.fg : "#9ca3af";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "left";
  if (value) ctx.fillText(value, x + 9, y + h / 2 + 5);
}
function label(ctx, x, y, text) {
  ctx.fillStyle = C.muted;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, x, y);
}

// Layout constants, 1:1 with the real 340px-wide popup (popup.css).
const POPUP_W = 340;
const PAD_X = 14;
const PAD_Y = 14;

/** Draws the popup header (logo + title). Returns new cursor y. */
function drawHeader(ctx, px, py, logoImg) {
  rr(ctx, px, py, POPUP_W, 46, 0);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, py + 46);
  ctx.lineTo(px + POPUP_W, py + 46);
  ctx.stroke();
  if (logoImg) ctx.drawImage(logoImg, px + PAD_X, py + 12, 22, 22);
  ctx.fillStyle = C.fg;
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Meeting Invite Scanner", px + PAD_X + 30, py + 27);
  return py + 46 + PAD_Y;
}

function drawDisplayName(ctx, px, cy) {
  label(ctx, px + PAD_X, cy + 10, "Your display name");
  input(ctx, px + PAD_X, cy + 16, POPUP_W - PAD_X * 2, 32, "Towfiq");
  return cy + 16 + 32 + 12;
}

function drawDropzone(ctx, px, cy) {
  const w = POPUP_W - PAD_X * 2;
  rr(ctx, px + PAD_X, cy, w, 100, 8);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.fg;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Drop an invite screenshot here", px + PAD_X + w / 2, cy + 44);
  ctx.fillStyle = C.muted;
  ctx.font = "11.5px system-ui, sans-serif";
  ctx.fillText("or click to choose \u00b7 or paste with Ctrl/\u2318+V", px + PAD_X + w / 2, cy + 62);
  ctx.textAlign = "left";
  return cy + 100 + 12;
}

function drawOrDivider(ctx, px, cy) {
  const w = POPUP_W - PAD_X * 2;
  const midY = cy + 7;
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + PAD_X, midY);
  ctx.lineTo(px + PAD_X + w / 2 - 16, midY);
  ctx.moveTo(px + PAD_X + w / 2 + 16, midY);
  ctx.lineTo(px + PAD_X + w, midY);
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("or", px + PAD_X + w / 2, midY + 4);
  ctx.textAlign = "left";
  return cy + 20;
}

function drawPasteText(ctx, px, cy) {
  const w = POPUP_W - PAD_X * 2;
  label(ctx, px + PAD_X, cy + 10, "Paste invite text");
  rr(ctx, px + PAD_X, cy + 16, w, 56, 6);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.stroke();
  ctx.fillStyle = C.fg;
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("Join Zoom Meeting", px + PAD_X + 9, cy + 32);
  ctx.fillText("https://zoom.us/j/84866750427", px + PAD_X + 9, cy + 48);
  ctx.fillStyle = C.muted;
  ctx.fillText("Meeting ID: 848 6675 0427   Passcode: 223999", px + PAD_X + 9, cy + 63);
  return cy + 16 + 56 + 12;
}

/** A loaded invite photo in the preview stage, with an optional crop box. */
function drawPreview(ctx, px, cy, { crop = false, height = 150 } = {}) {
  const w = POPUP_W - PAD_X * 2;
  const x = px + (POPUP_W - w) / 2;
  rr(ctx, x, cy, w, height, 6);
  const grad = ctx.createLinearGradient(x, cy, x, cy + height);
  grad.addColorStop(0, "#3b4252");
  grad.addColorStop(1, "#1f2430");
  ctx.fillStyle = grad;
  ctx.fill();

  // fake invite text lines, like a screenshotted Zoom invite
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Join Zoom Meeting", x + 18, cy + 30);
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("https://zoom.us/j/84866750427?pwd=Ab12Cd", x + 18, cy + 52);
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillText("Meeting ID: 848 6675 0427", x + 18, cy + 82);
  ctx.fillText("Passcode: 223999", x + 18, cy + 104);

  if (crop) {
    const cx0 = x + 14, cy0 = cy + 66, cw = w - 28, ch = 46;
    rr(ctx, cx0, cy0, cw, ch, 4);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(45, 140, 255, .18)";
    ctx.fill();
  }
  return cy + height + 8;
}

function drawPreviewBar(ctx, px, cy, { crop = false } = {}) {
  const w = POPUP_W - PAD_X * 2;
  ctx.fillStyle = C.muted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(
    crop ? "Tip: drag a box over the ID / passcode to scan just that part" : "Tip: drag to select just the ID or passcode",
    px + PAD_X,
    cy + 12,
    w - 90,
  );
  ctx.fillStyle = C.accent;
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("Scan selection", px + PAD_X + w, cy + 12);
  ctx.textAlign = "left";
  return cy + 28;
}

function drawStatus(ctx, px, cy, { pct = 0.6, text = "Scanning image (variant 3 of 5)\u2026" } = {}) {
  const w = POPUP_W - PAD_X * 2;
  rr(ctx, px + PAD_X, cy, w, 6, 3);
  ctx.fillStyle = C.border;
  ctx.fill();
  rr(ctx, px + PAD_X, cy, w * pct, 6, 3);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = C.muted;
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(text, px + PAD_X, cy + 24);
  return cy + 40;
}

function drawResult(ctx, px, cy, { confidence = "High confidence" } = {}) {
  const w = POPUP_W - PAD_X * 2;
  label(ctx, px + PAD_X, cy + 10, "Meeting ID");
  input(ctx, px + 84, cy + 2, w - (84 - PAD_X), 30, "848 6675 0427");
  cy += 34;
  label(ctx, px + PAD_X, cy + 10, "Passcode");
  input(ctx, px + 84, cy + 2, w - (84 - PAD_X), 30, "223999");
  cy += 34;

  ctx.fillStyle = confidence === "High confidence" ? C.ok : C.muted;
  ctx.font = "600 11.5px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(confidence, px + PAD_X, cy + 5);
  cy += 20;

  rr(ctx, px + PAD_X, cy, w, 36, 6);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = C.accentFg;
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Join meeting\u2026", px + PAD_X + w / 2, cy + 23);
  ctx.textAlign = "left";
  cy += 44;

  ctx.fillStyle = C.accent;
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.fillText("Copy app link", px + PAD_X, cy + 6);
  return cy + 22;
}

/** The "Join this meeting?" confirmation dialog, drawn as an overlay. */
function drawConfirmModal(ctx, cardX, cardY, cardW, cardH) {
  // dim the popup behind it
  ctx.fillStyle = "rgba(15, 20, 30, .5)";
  ctx.fillRect(cardX, cardY, cardW, cardH);

  const mw = 268, mh = 200;
  const mx = cardX + (cardW - mw) / 2;
  const my = cardY + (cardH - mh) / 2;
  rr(ctx, mx, my, mw, mh, 10);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.stroke();

  let y = my + 26;
  ctx.fillStyle = C.fg;
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("Join this meeting?", mx + 16, y);
  y += 22;

  const rows = [["Meeting ID", "848 6675 0427"], ["Passcode", "223999"], ["Name", "Towfiq"]];
  ctx.font = "12px system-ui, sans-serif";
  for (const [k, v] of rows) {
    ctx.fillStyle = C.muted;
    ctx.fillText(k, mx + 16, y);
    ctx.fillStyle = C.fg;
    ctx.font = "600 12px system-ui, sans-serif";
    ctx.fillText(v, mx + 90, y);
    ctx.font = "12px system-ui, sans-serif";
    y += 18;
  }
  y += 8;
  ctx.fillStyle = C.muted;
  ctx.fillText("Open with:", mx + 16, y);
  y += 12;

  const bw = (mw - 16 * 2 - 8) / 2;
  rr(ctx, mx + 16, y, bw, 34, 6);
  ctx.fillStyle = C.accent;
  ctx.fill();
  ctx.fillStyle = C.accentFg;
  ctx.font = "600 12.5px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Installed app", mx + 16 + bw / 2, y + 22);

  rr(ctx, mx + 16 + bw + 8, y, bw, 34, 6);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.stroke();
  ctx.fillStyle = C.fg;
  ctx.fillText("Browser", mx + 16 + bw + 8 + bw / 2, y + 22);
  ctx.textAlign = "left";
  y += 34 + 14;

  ctx.fillStyle = C.accent;
  ctx.font = "500 11.5px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Cancel", mx + mw / 2, y);
  ctx.textAlign = "left";
}

/**
 * Renders one popup "card" of a given content height at (px, py), with a
 * thin browser toolbar strip above it, drop shadow, and rounded corners.
 */
function drawCard(ctx, px, py, h) {
  ctx.save();
  ctx.shadowColor = "rgba(15, 23, 42, .18)";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  rr(ctx, px, py, POPUP_W, h, 10);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  rr(ctx, px, py, POPUP_W, h, 10);
  ctx.stroke();
}

/** Toolbar strip above the popup, with the extension icon "active". */
function drawToolbar(ctx, px, py, w, logoImg) {
  rr(ctx, px, py, w, 34, 8);
  ctx.fillStyle = "#f3f4f6";
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.stroke();
  ["#ff5f57", "#febc2e", "#28c840"].forEach((color, i) => {
    ctx.beginPath();
    ctx.arc(px + 16 + i * 16, py + 17, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  });
  rr(ctx, px + 70, py + 7, w - 70 - 90, 20, 5);
  ctx.fillStyle = C.bg;
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.stroke();
  ctx.fillStyle = C.muted;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("\ud83d\udd12 mail.google.com", px + 78, py + 21);
  if (logoImg) {
    rr(ctx, px + w - 40, py + 5, 24, 24, 6);
    ctx.fillStyle = "#eaf3ff";
    ctx.fill();
    ctx.drawImage(logoImg, px + w - 36, py + 9, 16, 16);
  }
}

// ---- scene composer ---------------------------------------------------
async function renderScene(canvas, { title, subtitle, scale, build }, logoImg) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = C.band;
  ctx.fillRect(0, 0, W, 118);
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 118, W, H - 118);

  ctx.textAlign = "center";
  ctx.fillStyle = "#0f172a";
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillText(title, W / 2, 62);
  ctx.fillStyle = C.muted;
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText(subtitle, W / 2, 92);
  ctx.textAlign = "left";

  // Build the popup content onto an offscreen canvas at 1x, so we can
  // measure its height before compositing at `scale` into the scene.
  const measureCanvas = createCanvas(POPUP_W, 1400);
  const mctx = measureCanvas.getContext("2d");
  const contentH = build(mctx, 0, 0, logoImg) - 0;

  const cardCanvas = createCanvas(POPUP_W, Math.ceil(contentH));
  const cctx = cardCanvas.getContext("2d");
  rr(cctx, 0, 0, POPUP_W, contentH, 10);
  cctx.fillStyle = C.bg;
  cctx.fill();
  build(cctx, 0, 0, logoImg);

  const cardW = POPUP_W * scale;
  const cardH = contentH * scale;
  const toolbarW = cardW + 40;
  const px = (W - toolbarW) / 2 + 20;
  const toolbarY = 118 + (H - 118 - (cardH + 34 + 16)) / 2;
  const cardY = toolbarY + 34 + 16;

  drawToolbar(ctx, px - 20, toolbarY, toolbarW, logoImg);
  drawCard(ctx, px, cardY, cardH);
  ctx.save();
  ctx.translate(px, cardY);
  ctx.scale(scale, scale);
  // re-clip to rounded corners of the card before drawing content
  rr(ctx, 0, 0, POPUP_W, contentH, 10 / scale);
  ctx.clip();
  ctx.drawImage(cardCanvas, 0, 0);
  ctx.restore();

  return { px, cardY, cardW, cardH };
}

const SCENES = [
  {
    file: "screenshot-1-empty.png",
    title: "Scan a Zoom invite in one click",
    subtitle: "Drop a screenshot, paste an image, or paste the invite text",
    scale: 1.55,
    build(ctx, px, py, logoImg) {
      let cy = drawHeader(ctx, px, py, logoImg);
      cy = drawDisplayName(ctx, px, cy);
      cy = drawDropzone(ctx, px, cy);
      cy = drawOrDivider(ctx, px, cy);
      cy = drawPasteText(ctx, px, cy);
      return cy + PAD_Y - 12;
    },
  },
  {
    file: "screenshot-2-scanning.png",
    title: "OCR runs 100% on-device",
    subtitle: "No image or text ever leaves your machine \u2014 no server, no upload",
    scale: 1.55,
    build(ctx, px, py, logoImg) {
      let cy = drawHeader(ctx, px, py, logoImg);
      cy = drawDisplayName(ctx, px, cy);
      cy = drawPreview(ctx, px, cy, { height: 150 });
      cy = drawStatus(ctx, px, cy);
      return cy + PAD_Y - 4;
    },
  },
  {
    file: "screenshot-3-results.png",
    title: "Meeting ID and passcode, read for you",
    subtitle: "Fields stay editable \u2014 fix anything OCR got wrong before joining",
    scale: 1.55,
    build(ctx, px, py, logoImg) {
      let cy = drawHeader(ctx, px, py, logoImg);
      cy = drawDisplayName(ctx, px, cy);
      cy = drawPreview(ctx, px, cy, { height: 120 });
      cy = drawResult(ctx, px, cy);
      return cy + PAD_Y - 12;
    },
  },
  {
    file: "screenshot-4-crop.png",
    title: "Rough photo? Crop and rescan",
    subtitle: "Drag a box over the ID or passcode for a sharper, targeted read",
    scale: 1.55,
    build(ctx, px, py, logoImg) {
      let cy = drawHeader(ctx, px, py, logoImg);
      cy = drawDisplayName(ctx, px, cy);
      cy = drawPreview(ctx, px, cy, { height: 160, crop: true });
      cy = drawPreviewBar(ctx, px, cy, { crop: true });
      return cy + PAD_Y - 8;
    },
  },
  {
    file: "screenshot-5-confirm.png",
    title: "You choose: app or browser",
    subtitle: "Nothing opens until you confirm the ID, passcode, and name",
    scale: 1.55,
    build(ctx, px, py, logoImg) {
      let cy = drawHeader(ctx, px, py, logoImg);
      cy = drawDisplayName(ctx, px, cy);
      cy = drawPreview(ctx, px, cy, { height: 110 });
      cy = drawResult(ctx, px, cy);
      return cy + PAD_Y - 12;
    },
    overlay: true,
  },
];

async function generateScreenshots(logoImg) {
  for (const scene of SCENES) {
    const canvas = createCanvas(1280, 800);
    const { px, cardY, cardW, cardH } = await renderScene(canvas, scene, logoImg);
    if (scene.overlay) {
      drawConfirmModal(canvas.getContext("2d"), px, cardY, cardW, cardH);
    }
    await saveOpaquePng(canvas, join(OUT, scene.file));
  }
}

async function generatePromoTile(logoImg) {
  const tile = createCanvas(440, 280);
  const t = tile.getContext("2d");
  t.fillStyle = "#f8fafc";
  t.fillRect(0, 0, 440, 280);
  t.fillStyle = C.accent;
  t.fillRect(0, 0, 440, 60);
  if (logoImg) t.drawImage(logoImg, 22, 16, 28, 28);
  t.fillStyle = "#ffffff";
  t.font = "600 20px system-ui, sans-serif";
  t.textAlign = "left";
  t.fillText("Meeting Invite Scanner", 62, 39);
  t.fillStyle = C.muted;
  t.font = "13px system-ui, sans-serif";
  t.fillText("Scan a Zoom invite photo \u00b7 OCR on-device", 24, 88);

  rr(t, 24, 106, 200, 34, 6);
  t.fillStyle = "#ffffff";
  t.fill();
  t.strokeStyle = C.border;
  t.lineWidth = 1;
  t.stroke();
  t.fillStyle = C.fg;
  t.font = "600 14px system-ui, sans-serif";
  t.fillText("ID: 848 6675 0427", 34, 128);

  rr(t, 230, 106, 186, 34, 6);
  t.fillStyle = "#ffffff";
  t.fill();
  t.strokeStyle = C.border;
  t.stroke();
  t.fillStyle = C.fg;
  t.fillText("Passcode: 223999", 240, 128);

  t.fillStyle = "#9ca3af";
  t.font = "11px system-ui, sans-serif";
  t.fillText("Unofficial. Not affiliated with Zoom.", 24, 250);

  await saveOpaquePng(tile, join(OUT, "promo-tile-440x280.png"));
}

async function generateMarquee(logoImg) {
  const W = 1400, H = 560;
  const canvas = createCanvas(W, H);
  const m = canvas.getContext("2d");

  const grad = m.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1560c9");
  grad.addColorStop(1, "#2d8cff");
  m.fillStyle = grad;
  m.fillRect(0, 0, W, H);

  // logo badge
  rr(m, 90, 130, 96, 96, 20);
  m.fillStyle = "#ffffff";
  m.fill();
  if (logoImg) m.drawImage(logoImg, 106, 146, 64, 64);

  m.fillStyle = "#ffffff";
  m.font = "700 46px system-ui, sans-serif";
  m.textAlign = "left";
  m.fillText("Meeting Invite Scanner", 216, 172);
  m.font = "500 22px system-ui, sans-serif";
  m.fillStyle = "rgba(255,255,255,.92)";
  m.fillText("Scan a Zoom invite photo. Get the ID and passcode. Join.", 216, 210);

  const bullets = [
    "On-device OCR \u2014 nothing ever leaves your machine",
    "Reads screenshots and rough phone photos alike",
    "Join in the Zoom app or the web, your choice",
  ];
  m.font = "18px system-ui, sans-serif";
  let by = 258;
  for (const b of bullets) {
    m.fillStyle = "#ffffff";
    m.beginPath();
    m.arc(224, by - 6, 4, 0, Math.PI * 2);
    m.fill();
    m.fillStyle = "rgba(255,255,255,.95)";
    m.fillText(b, 240, by);
    by += 32;
  }

  // mini popup mockup on the right
  const mockW = 300, mockH = 340;
  const mockX = W - 90 - mockW, mockY = (H - mockH) / 2;
  m.save();
  m.shadowColor = "rgba(0,0,0,.35)";
  m.shadowBlur = 40;
  m.shadowOffsetY = 18;
  rr(m, mockX, mockY, mockW, mockH, 14);
  m.fillStyle = "#ffffff";
  m.fill();
  m.restore();

  const scale = mockW / POPUP_W;
  m.save();
  m.translate(mockX, mockY);
  m.scale(scale, scale);
  rr(m, 0, 0, POPUP_W, mockH / scale, 14 / scale);
  m.clip();
  let cy = drawHeader(m, 0, 0, logoImg);
  cy = drawDisplayName(m, 0, cy);
  cy = drawPreview(m, 0, cy, { height: 110 });
  drawResult(m, 0, cy);
  m.restore();

  m.textAlign = "left";
  m.fillStyle = "rgba(255,255,255,.75)";
  m.font = "13px system-ui, sans-serif";
  m.fillText("Unofficial \u2014 not affiliated with, endorsed by, or sponsored by Zoom Video Communications, Inc.", 216, H - 36);

  await saveOpaquePng(canvas, join(OUT, "marquee-1400x560.png"));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const logoImg = await loadImage(join(ROOT, "icons", "icon-128.png"));
  await generateScreenshots(logoImg);
  await generatePromoTile(logoImg);
  await generateMarquee(logoImg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
