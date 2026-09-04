/**
 * ocr.js — thin wrapper around the vendored Tesseract.js.
 *
 * Everything (worker, wasm core, language data) is loaded from the extension
 * bundle. No network requests are made at runtime, which is why the CSP in
 * manifest.json only needs 'self' + 'wasm-unsafe-eval'.
 *
 * Expects window.Tesseract to be provided by vendor/tesseract.min.js
 * (loaded as a classic script before this module).
 */

const rtURL = (p) =>
  (globalThis.chrome?.runtime?.getURL || globalThis.browser?.runtime?.getURL)(p);

let workerPromise = null;
// Tesseract's logger is fixed at worker-creation time, but recognizeText() is
// called once per image variant — so route the creation logger through this
// swappable slot and let each call install its own progress handler.
let progressSink = null;

function getWorker() {
  if (workerPromise) return workerPromise;

  const { createWorker } = globalThis.Tesseract;
  workerPromise = createWorker("eng", 1, {
    workerPath: rtURL("vendor/worker.min.js"),
    corePath: rtURL("vendor/"), // dir; Tesseract picks the SIMD LSTM core
    langPath: rtURL("vendor/"), // dir containing eng.traineddata.gz
    workerBlobURL: false, // must load the real file, not a blob (CSP)
    gzip: true,
    logger: (m) => {
      if (progressSink && m.status) progressSink(m);
    },
  }).catch((err) => {
    workerPromise = null; // allow retry on failure
    throw err;
  });
  return workerPromise;
}

/**
 * Run OCR on an image and return both the plain text and Tesseract's
 * line-level bounding boxes (the latter is what lets popup.js re-crop and
 * re-OCR just the meeting-ID line at higher magnification when the first
 * pass's digits look unreliable — see the "refine" step there).
 * @param {Blob|File|HTMLImageElement|HTMLCanvasElement|string} image
 * @param {(m:{status:string,progress:number})=>void} [onProgress]
 * @param {string} [psm] Tesseract page-segmentation mode. "3" (fully
 *   automatic, no OSD) is the default and needs no osd.traineddata, but on a
 *   distant photo (whole laptop + desk around a small dialog) its layout
 *   analysis can drop a thin text line entirely rather than misread it — "6"
 *   (assume a single uniform block) recovers those. Callers retry with "6"
 *   when "3" comes up empty; see popup.js.
 * @returns {Promise<{text:string, lines:Array<{text:string,bbox:{x0:number,y0:number,x1:number,y1:number}}>}>}
 */
export async function recognizeDetailed(image, onProgress, psm = "3") {
  const worker = await getWorker();
  progressSink = onProgress || null;
  // Keep inter-word spaces so grouped meeting IDs ("893 6612 6292") survive.
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    preserve_interword_spaces: "1",
  });
  try {
    const { data } = await worker.recognize(image);
    return { text: data.text || "", lines: data.lines || [] };
  } finally {
    progressSink = null;
  }
}

/**
 * Convenience wrapper around recognizeDetailed() for callers that only need
 * the text.
 * @returns {Promise<string>} recognized plain text
 */
export async function recognizeText(image, onProgress, psm = "3") {
  const { text } = await recognizeDetailed(image, onProgress, psm);
  return text;
}

export async function terminateOcr() {
  if (!workerPromise) return;
  try {
    const w = await workerPromise;
    await w.terminate();
  } catch {
    /* ignore */
  }
  workerPromise = null;
}
