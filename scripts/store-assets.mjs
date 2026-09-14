import { createCanvas, loadImage } from "@napi-rs/canvas";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets", "store");

// Popup layout constants (from popup.css)
const POPUP_W = 340;
const POPUP_HEADER_H = 46; // 12+14+12 padding + border
const FIELD_GAP = 12;
const FIELD_H = 56; // label + input
const DIVIDER_H = 20;
const DZ_H = 100;
const OR_H = 20;
const TEXTAREA_H = 66;
const PREVIEW_BAR_H = 30;
const RESULT_ROW_H = 46;
const CONF_H = 20;
const ACTIONS_H = 40;
const LINK_H = 24;
const PAD_X = 14;
const PAD_Y = 14;

function drawRoundedRect(ctx, x, y, w, h, r) {
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

function drawInput(ctx, x, y, w, h, value, placeholder, isTextarea = false) {
  drawRoundedRect(ctx, x, y, w, h, 6);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "13px system-ui, sans-serif";
  if (value) {
    ctx.fillText(value, x + 9, y + (h / 2) + 5);
  } else if (placeholder) {
    ctx.fillStyle = "#9ca3af";
    ctx.fillText(placeholder, x + 9, y + (h / 2) + 5);
  }
}

async function drawPopup(canvas) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // Desktop/browser background
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, W, H);

  // Browser chrome bar
  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, W, 32);
  ctx.fillStyle = "#d1d5db";
  ctx.fillRect(0, 32, W, 1);

  // Popup body background
  const px = Math.floor((W - POPUP_W) / 2);
  const py = 60;
  drawRoundedRect(ctx, px, py, POPUP_W, 480, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Header
  ctx.fillStyle = "#2d8cff";
  ctx.fillRect(px, py, POPUP_W, POPUP_HEADER_H);
  // Logo mark (white square)
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(px + 16, py + 12, 18, 18);
  ctx.fillStyle = "#2d8cff";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillText("Z", px + 21, py + 25);
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.fillText("Meeting Invite Scanner", px + 42, py + 24);

  // Divider
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, py + POPUP_HEADER_H);
  ctx.lineTo(px + POPUP_W, py + POPUP_HEADER_H);
  ctx.stroke();

  let cy = py + POPUP_HEADER_H + PAD_Y;

  // Display name field
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("Your display name", px + PAD_X, cy + 10);
  drawInput(ctx, px + PAD_X, cy + 16, POPUP_W - PAD_X * 2, 32, "Towfiq", "");
  cy += 16 + 32 + FIELD_GAP;

  // Dropzone
  drawRoundedRect(ctx, px + PAD_X, cy, POPUP_W - PAD_X * 2, DZ_H, 8);
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#9ca3af";
  ctx.font = "11.5px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Drop an invite screenshot here", px + (POPUP_W - PAD_X * 2) / 2, cy + 36);
  ctx.fillText("or click to choose · or paste with Ctrl/⌘+V", px + (POPUP_W - PAD_X * 2) / 2, cy + 54);
  ctx.textAlign = "left";
  cy += DZ_H + FIELD_GAP;

  // OR divider
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui, sans-serif";
  ctx.textAlign = "center";
  const orY = cy + 7;
  ctx.fillText("or", px + (POPUP_W - PAD_X * 2) / 2, orY);
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px + PAD_X, orY);
  ctx.lineTo(px + (POPUP_W - PAD_X * 2) / 2 - 20, orY);
  ctx.moveTo(px + (POPUP_W - PAD_X * 2) / 2 + 20, orY);
  ctx.lineTo(px + POPUP_W - PAD_X, orY);
  ctx.stroke();
  ctx.textAlign = "left";
  cy += 20;

  // Paste invite text (textarea with content)
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("Paste invite text", px + PAD_X, cy + 10);
  drawInput(ctx, px + PAD_X, cy + 16, POPUP_W - PAD_X * 2, 56, "", "", true);
  // Fill textarea content
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "13px system-ui, sans-serif";
  ctx.fillText("Join Zoom Meeting", px + 9, cy + 24);
  ctx.fillText("https://zoom.us/j/84866750427", px + 9, cy + 40);
  ctx.fillStyle = "#6b7280";
  ctx.fillText("Meeting ID: 848 6675 0427   Passcode: 223999", px + 9, cy + 55);
  cy += 16 + 56 + FIELD_GAP;

  // Preview area (showing loaded image with crop)
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "12px system-ui, sans-serif";
  // Simulated image
  drawRoundedRect(ctx, px + PAD_X, cy, 180, 100, 6);
  ctx.fillStyle = "#374151";
  ctx.fill();
  ctx.fillStyle = "#6b7280";
  ctx.textAlign = "center";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("[invite image]", px + PAD_X + 90, cy + 54);
  ctx.textAlign = "left";
  // Crop selection overlay
  drawRoundedRect(ctx, px + PAD_X + 40, cy + 15, 100, 70, 4);
  ctx.strokeStyle = "#2d8cff";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.fillStyle = "rgba(45, 140, 255, .12)";
  ctx.fill();
  ctx.setLineDash([]);
  cy += 100 + 6 + 10;

  // Preview bar
  ctx.fillStyle = "#6b7280";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("Tip: drag a box over the ID / passcode to scan just that part", px + PAD_X, cy + 12);
  ctx.fillStyle = "#2d8cff";
  ctx.fillText("Scan selection", px + POPUP_W - PAD_X - 70, cy + 12);
  cy += 28;

  // Result section
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "12px system-ui, sans-serif";

  // Meeting ID row
  ctx.fillStyle = "#6b7280";
  ctx.fillText("Meeting ID", px + PAD_X, cy + 10);
  drawInput(ctx, px + 84, cy + 2, POPUP_W - PAD_X - 84, 30, "848 6675 0427", "");
  cy += 34;

  // Passcode row
  ctx.fillStyle = "#6b7280";
  ctx.fillText("Passcode", px + PAD_X, cy + 10);
  drawInput(ctx, px + 84, cy + 2, POPUP_W - PAD_X - 84, 30, "223999", "");
  cy += 34;

  // Confidence
  ctx.fillStyle = "#047857";
  ctx.font = '11.5px system-ui, sans-serif';
  ctx.fillText("High confidence", px + PAD_X, cy + 5);
  cy += 18;

  // Join button
  drawRoundedRect(ctx, px + PAD_X, cy, POPUP_W - PAD_X * 2, 36, 6);
  ctx.fillStyle = "#2d8cff";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Join meeting…", px + (POPUP_W - PAD_X * 2) / 2, cy + 23);
  ctx.textAlign = "left";
  cy += 42;

  // Copy app link
  ctx.fillStyle = "#2d8cff";
  ctx.font = '500 12px system-ui, sans-serif';
  ctx.fillText("Copy app link", px + PAD_X, cy + 6);
  cy += 20;

  // OCR text (collapsed details)
  ctx.fillStyle = "#6b7280";
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText("▸ OCR text", px + PAD_X, cy + 5);
}

async function generateScreenshots() {
  await mkdir(OUT, { recursive: true });

  // 1280x800 screenshot
  const shot1280 = createCanvas(1280, 800);
  await drawPopup(shot1280);
  await writeFile(join(OUT, "screenshot-1280x800.png"), shot1280.toBuffer("image/png"));
  console.log("Generated screenshot-1280x800.png");

  // 640x400 screenshot (scaled down version of same layout)
  const shot640 = createCanvas(640, 400);
  const ctx640 = shot640.getContext("2d");
  ctx640.scale(0.5, 0.5);
  await drawPopup(shot640);
  await writeFile(join(OUT, "screenshot-640x400.png"), shot640.toBuffer("image/png"));
  console.log("Generated screenshot-640x400.png");

  // 440x280 promo tile
  const tile = createCanvas(440, 280);
  const tctx = tile.getContext("2d");
  // Background
  tctx.fillStyle = "#f8fafc";
  tctx.fillRect(0, 0, 440, 280);
  // Header band
  tctx.fillStyle = "#2d8cff";
  tctx.fillRect(0, 0, 440, 60);
  // Logo
  tctx.fillStyle = "#ffffff";
  tctx.fillRect(24, 18, 28, 28);
  tctx.fillStyle = "#2d8cff";
  tctx.font = "bold 16px system-ui, sans-serif";
  tctx.fillText("Z", 32, 38);
  // Title
  tctx.fillStyle = "#ffffff";
  tctx.font = "600 20px system-ui, sans-serif";
  tctx.fillText("Meeting Invite Scanner", 64, 39);
  // Subtitle
  tctx.fillStyle = "#6b7280";
  tctx.font = "13px system-ui, sans-serif";
  tctx.fillText("Scan a Zoom invite photo · OCR on-device", 24, 88);
  // Meeting ID pill
  drawRoundedRect(tctx, 24, 106, 200, 34, 6);
  tctx.fillStyle = "#ffffff";
  tctx.fill();
  tctx.strokeStyle = "#d1d5db";
  tctx.lineWidth = 1;
  tctx.stroke();
  tctx.fillStyle = "#1a1a1a";
  tctx.font = "600 14px system-ui, sans-serif";
  tctx.fillText("ID: 848 6675 0427", 34, 128);
  // Passcode pill
  drawRoundedRect(tctx, 230, 106, 186, 34, 6);
  tctx.fillStyle = "#ffffff";
  tctx.fill();
  tctx.strokeStyle = "#d1d5db";
  tctx.lineWidth = 1;
  tctx.stroke();
  tctx.fillStyle = "#1a1a1a";
  tctx.fillText("Passcode: 223999", 240, 128);
  // Footer disclaimer
  tctx.fillStyle = "#9ca3af";
  tctx.font = "11px system-ui, sans-serif";
  tctx.fillText("Unofficial. Not affiliated with Zoom.", 24, 250);

  await writeFile(join(OUT, "promo-tile-440x280.png"), tile.toBuffer("image/png"));
  console.log("Generated promo-tile-440x280.png");
}

generateScreenshots().catch((e) => {
  console.error(e);
  process.exit(1);
});
