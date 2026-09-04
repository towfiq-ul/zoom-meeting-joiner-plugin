/**
 * preprocess.js — Canvas image cleanup before OCR.
 *
 * Photos of a screen are the hard case: bezel / keyboard / desktop around a
 * small, low-contrast invite panel, plus moiré. No single cleanup wins on every
 * photo, so we emit several complementary variants and the caller OCRs each and
 * votes (src/combine.js).
 *
 * Notable choices, learned from real photos:
 *  - contrast stretch is *percentile*-based (absolute min/max is a no-op on a
 *    photo — there's always a near-black and near-white pixel);
 *  - upscaling uses a real Lanczos-3 resampler, not Canvas bilinear, which
 *    smears small faint text into the background;
 *  - the content box is found by edge-energy AND brightness (text-rich bright
 *    tiles), so a dark keyboard and a smooth bright desktop are both excluded;
 *  - if that can't localise a sub-region, we fall back to horizontal band
 *    crops so at least one variant frames the dialog.
 */

const TARGET_W = 1800; // upscale the region to about this width before OCR
const MAX_DIM = 3000; // never produce a canvas bigger than this on either axis

// ---- canvas / bitmap helpers ---------------------------------------------
async function toBitmap(blob) {
  if ("createImageBitmap" in globalThis) return createImageBitmap(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

function makeCanvas(w, h) {
  if ("OffscreenCanvas" in globalThis) return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function grayFromImageData(data, W, H) {
  const g = new Float32Array(W * H);
  for (let i = 0, j = 0; j < W * H; i += 4, j++) {
    g[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return g;
}

function grayToCanvas(g, W, H) {
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  const id = ctx.createImageData(W, H);
  for (let j = 0, i = 0; j < W * H; j++, i += 4) {
    const v = g[j] < 0 ? 0 : g[j] > 255 ? 255 : g[j];
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
    id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

// ---- conservative dark-border trim -----------------------------------
/**
 * Trim only rows/columns that are essentially black (laptop bezel, letterbox).
 * Never aggressive — anything with visible content is kept, and content
 * localisation proper is left to the fixed region set + the manual selector.
 */
function trimDarkBorders(g, W, H) {
  const DARK = 34;
  const rowMean = new Float32Array(H);
  const colMean = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    let s = 0;
    for (let x = 0; x < W; x++) s += g[y * W + x];
    rowMean[y] = s / W;
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = 0; y < H; y++) s += g[y * W + x];
    colMean[x] = s / H;
  }
  let top = 0, bot = H - 1, left = 0, right = W - 1;
  while (top < bot && rowMean[top] < DARK) top++;
  while (bot > top && rowMean[bot] < DARK) bot--;
  while (left < right && colMean[left] < DARK) left++;
  while (right > left && colMean[right] < DARK) right--;
  return { left, top, w: right - left + 1, h: bot - top + 1 };
}

// ---- pixel ops (all on Float32 grayscale) -----------------------------
function buildWeights(srcLen, dstLen, a) {
  const ratio = dstLen / srcLen;
  const fscale = ratio < 1 ? 1 / ratio : 1;
  const support = a * fscale;
  const out = [];
  for (let i = 0; i < dstLen; i++) {
    const center = (i + 0.5) / ratio - 0.5;
    const s0 = Math.max(0, Math.ceil(center - support));
    const s1 = Math.min(srcLen - 1, Math.floor(center + support));
    const idx = [];
    const wt = [];
    let sum = 0;
    for (let s = s0; s <= s1; s++) {
      const x = (s - center) / fscale;
      let w;
      if (x === 0) w = 1;
      else if (x <= -a || x >= a) w = 0;
      else {
        const px = Math.PI * x;
        w = (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
      }
      idx.push(s);
      wt.push(w);
      sum += w;
    }
    for (let k = 0; k < wt.length; k++) wt[k] /= sum || 1;
    out.push({ idx: Int32Array.from(idx), wt: Float32Array.from(wt) });
  }
  return out;
}

/** Separable Lanczos-3 resample of a Float32 grayscale plane. */
function resample(src, sw, sh, dw, dh) {
  const a = 3;
  const wx = buildWeights(sw, dw, a);
  const tmp = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const srow = y * sw;
    const trow = y * dw;
    for (let x = 0; x < dw; x++) {
      const { idx, wt } = wx[x];
      let acc = 0;
      for (let k = 0; k < idx.length; k++) acc += src[srow + idx[k]] * wt[k];
      tmp[trow + x] = acc;
    }
  }
  const wy = buildWeights(sh, dh, a);
  const out = new Float32Array(dw * dh);
  for (let x = 0; x < dw; x++) {
    for (let y = 0; y < dh; y++) {
      const { idx, wt } = wy[y];
      let acc = 0;
      for (let k = 0; k < idx.length; k++) acc += tmp[idx[k] * dw + x] * wt[k];
      out[y * dw + x] = acc;
    }
  }
  return out;
}

function cropGray(g, W, H, { left, top, w, h }) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const s = (top + y) * W + left;
    out.set(g.subarray(s, s + w), y * w);
  }
  return out;
}

/** Percentile contrast stretch (2nd / 98th), in place. */
function stretch(g) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) {
    const v = g[i] < 0 ? 0 : g[i] > 255 ? 255 : g[i];
    hist[v | 0]++;
  }
  const loCut = g.length * 0.02;
  const hiCut = g.length * 0.98;
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc <= loCut) lo = v;
    if (acc < hiCut) hi = v;
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < g.length; i++) {
    let v = ((g[i] - lo) * 255) / range;
    g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

/** Gamma lift (g>1 brightens midtones, pulls faint gray text off the page). */
function gammaLift(gr, gamma) {
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, 1 / gamma);
  for (let i = 0; i < gr.length; i++) gr[i] = lut[gr[i] | 0];
}

/** One 3-tap separable box pass (call twice for ~radius 1.5). */
function boxBlur(g, W, H) {
  const t = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const a = x > 0 ? g[p - 1] : g[p];
      const b = x < W - 1 ? g[p + 1] : g[p];
      t[p] = (a + g[p] + b) / 3;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const a = y > 0 ? t[p - W] : t[p];
      const b = y < H - 1 ? t[p + W] : t[p];
      g[p] = (a + t[p] + b) / 3;
    }
  }
}

/** Unsharp mask against a blurred copy. */
function sharpen(g, W, H, amount = 1.1) {
  const blur = Float32Array.from(g);
  boxBlur(blur, W, H);
  for (let i = 0; i < g.length; i++) {
    let v = g[i] + amount * (g[i] - blur[i]);
    g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
}

// ---- variant assembly -------------------------------------------------
/** The upscale factor render()/renderNative() apply to a given source region. */
function calcScale(region) {
  return Math.min(MAX_DIM / region.w, MAX_DIM / region.h, Math.max(1.5, TARGET_W / region.w));
}

function render(srcGray, W, H, region, { gamma = 0, blur = false } = {}) {
  const g0 = cropGray(srcGray, W, H, region);
  const scale = calcScale(region);
  const dw = Math.max(1, Math.round(region.w * scale));
  const dh = Math.max(1, Math.round(region.h * scale));
  const g = resample(g0, region.w, region.h, dw, dh);
  if (blur) {
    boxBlur(g, dw, dh);
    boxBlur(g, dw, dh);
  }
  stretch(g);
  if (gamma) gammaLift(g, gamma);
  sharpen(g, dw, dh);
  return grayToCanvas(g, dw, dh);
}

/**
 * Alternate upscale path using the canvas's own high-quality resize instead
 * of the hand-rolled Lanczos-3 resample() above. Lanczos was chosen because
 * canvas *bilinear* smears small text (see file preamble) — but at the high
 * magnification a small region needs, its ringing can bend a thin glyph's
 * curve into a different digit (a "6" reading as "8"/"5"); the canvas's own
 * "high"-quality resize doesn't share that failure mode on real photos.
 * Kept as an additional vote member alongside the Lanczos variants rather
 * than a replacement, since Lanczos still wins on other photos.
 */
function renderNative(colorCanvas, region, { gamma = 0 } = {}) {
  const scale = calcScale(region);
  const dw = Math.max(1, Math.round(region.w * scale));
  const dh = Math.max(1, Math.round(region.h * scale));
  const c = makeCanvas(dw, dh);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(colorCanvas, region.left, region.top, region.w, region.h, 0, 0, dw, dh);
  const g = grayFromImageData(ctx.getImageData(0, 0, dw, dh).data, dw, dh);
  stretch(g);
  if (gamma) gammaLift(g, gamma);
  return grayToCanvas(g, dw, dh);
}

/**
 * Map a Tesseract line/word bbox (pixel coords on one variant's *canvas*,
 * i.e. already cropped-to-region and upscaled) back to a pixel box on the
 * ORIGINAL image, so it can be handed back into preprocessVariants() as a
 * manualRegion for a tight, freshly-upscaled re-OCR of just that line — see
 * the "refine" step in popup.js.
 * @param {{region:{left:number,top:number}, scale:number}} variant
 * @param {{x0:number,y0:number,x1:number,y1:number}} bbox
 * @param {number} [pad] extra pixels of context to keep on each side, in
 *   ORIGINAL image pixels
 */
export function bboxToOriginalRegion(variant, bbox, pad = 4) {
  const { region, scale } = variant;
  return {
    left: region.left + bbox.x0 / scale - pad,
    top: region.top + bbox.y0 / scale - pad,
    w: (bbox.x1 - bbox.x0) / scale + pad * 2,
    h: (bbox.y1 - bbox.y0) / scale + pad * 2,
  };
}

/**
 * @param {Blob|File} blob
 * @param {{left:number,top:number,w:number,h:number}} [manualRegion] pixel box
 *        (in the original image) chosen by the user; when given, auto-crop is
 *        skipped and only that region is processed.
 * @returns {Promise<{name:string, canvas:HTMLCanvasElement|OffscreenCanvas,
 *            region:{left:number,top:number,w:number,h:number}, scale:number}[]>}
 */
export async function preprocessVariants(blob, manualRegion) {
  const bmp = await toBitmap(blob);
  const W = bmp.width;
  const H = bmp.height;
  const probe = makeCanvas(W, H);
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  pctx.drawImage(bmp, 0, 0);
  const gray = grayFromImageData(pctx.getImageData(0, 0, W, H).data, W, H);
  if (bmp.close) bmp.close();

  if (manualRegion) {
    const r = {
      left: Math.max(0, Math.round(manualRegion.left)),
      top: Math.max(0, Math.round(manualRegion.top)),
      w: Math.min(W, Math.round(manualRegion.w)),
      h: Math.min(H, Math.round(manualRegion.h)),
    };
    const scale = calcScale(r);
    return [
      { name: "sel", canvas: render(gray, W, H, r), region: r, scale },
      { name: "sel-gamma", canvas: render(gray, W, H, r, { gamma: 2.2 }), region: r, scale },
      { name: "sel-blur", canvas: render(gray, W, H, r, { blur: true }), region: r, scale },
      { name: "sel-native", canvas: renderNative(probe, r), region: r, scale },
    ];
  }

  // Trim pure-black borders, then work with fixed regions of what's left. A
  // Zoom invite's meeting-ID line is always in the upper part of the panel, so
  // "upper" reliably frames it even when "full" is too busy; "mid" catches the
  // passcode row. The vote across these + full is what makes it robust.
  const b = trimDarkBorders(gray, W, H);
  const sub = (a, z) => ({
    left: b.left,
    top: b.top + Math.round(b.h * a),
    w: b.w,
    h: Math.max(1, Math.round(b.h * (z - a))),
  });
  const specs = [
    ["full", b, {}],
    ["full-blur", b, { blur: true }],
    ["upper", sub(0, 0.6), {}],
    ["upper-blur", sub(0, 0.6), { blur: true }],
    ["mid", sub(0.18, 0.74), {}],
  ];

  const out = specs.map(([name, region, opts]) => ({
    name,
    canvas: render(gray, W, H, region, opts),
    region,
    scale: calcScale(region),
  }));
  // Also try the ID and passcode regions through the native resize path (see
  // renderNative) — the region small enough to need heavy magnification is
  // the one most prone to a Lanczos misread, so give it more than one shot.
  const upperRegion = sub(0, 0.6);
  const midRegion = sub(0.18, 0.74);
  out.push({ name: "full-native", canvas: renderNative(probe, b), region: b, scale: calcScale(b) });
  out.push({
    name: "upper-native",
    canvas: renderNative(probe, upperRegion),
    region: upperRegion,
    scale: calcScale(upperRegion),
  });
  out.push({
    name: "mid-native",
    canvas: renderNative(probe, midRegion),
    region: midRegion,
    scale: calcScale(midRegion),
  });
  return out;
}

/** Single best-effort variant (kept for callers that want just one). */
export async function preprocessForOcr(blob) {
  return (await preprocessVariants(blob))[0].canvas;
}
