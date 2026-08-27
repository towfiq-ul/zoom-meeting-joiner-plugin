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
 * Run OCR on an image.
 * @param {Blob|File|HTMLImageElement|HTMLCanvasElement|string} image
 * @param {(m:{status:string,progress:number})=>void} [onProgress]
 * @returns {Promise<string>} recognized plain text
 */
export async function recognizeText(image, onProgress) {
  const worker = await getWorker();
  progressSink = onProgress || null;
  // PSM 3 (fully automatic, no OSD) reads the invite panel's mixed layout best
  // in testing, and needs no osd.traineddata. Keep inter-word spaces so grouped
  // meeting IDs ("893 6612 6292") survive.
  await worker.setParameters({
    tessedit_pageseg_mode: "3",
    preserve_interword_spaces: "1",
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text || "";
  } finally {
    progressSink = null;
  }
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
