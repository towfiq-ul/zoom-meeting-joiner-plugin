/**
 * End-to-end image-processing check (NOT part of `node --test`).
 *
 *   node scripts/ocr-sample.mjs [image ...]
 *
 * Runs the *actual* extension pipeline — src/preprocess.js (Canvas code, via a
 * @napi-rs/canvas shim), the vendored offline Tesseract, src/parser.js and
 * src/combine.js — against the real reference photos in assets/.
 *
 * Dev deps:  npm i --no-save tesseract.js@5.1.1 @napi-rs/canvas
 */
import { createCanvas, ImageData as NapiImageData, loadImage } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, basename } from "node:path";
import { readFileSync } from "node:fs";
import { extractMeetingInfo, buildJoinUrl } from "../src/parser.js";
import { combineResults } from "../src/combine.js";

// --- Canvas shims so src/preprocess.js runs unchanged under Node ----------
class OffscreenCanvasShim {
  constructor(w, h) {
    this._c = createCanvas(w, h);
    this.width = w;
    this.height = h;
  }
  getContext(t) {
    return this._c.getContext(t);
  }
}
globalThis.OffscreenCanvas = OffscreenCanvasShim;
globalThis.ImageData = NapiImageData;
globalThis.createImageBitmap = async (buf) => loadImage(buf);

const { preprocessVariants } = await import("../src/preprocess.js");

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// expected values; `null` passcode = known-unreadable on that photo (ID only)
const KNOWN = {
  "sample-invite.jpeg": ["89366126292", "017970"],
  "sample-invite-2.jpeg": ["85119875308", "048349"],
  "sample-invite-3.jpeg": ["89366126292", null],
};

const inputs = process.argv.slice(2);
if (!inputs.length) inputs.push(...Object.keys(KNOWN).map((f) => join(root, "assets", f)));

const worker = await createWorker("eng", 1, {
  langPath: join(root, "vendor"),
  gzip: true,
  cacheMethod: "none",
});
await worker.setParameters({ tessedit_pageseg_mode: "3", preserve_interword_spaces: "1" });

let failures = 0;

for (const input of inputs) {
  const img = resolve(input);
  const name = basename(img);
  console.log(`\n==================  ${name}  ==================`);
  const buf = readFileSync(img);
  const variants = await preprocessVariants(buf);

  const results = [];
  for (const v of variants) {
    const png = v.canvas._c.toBuffer("image/png");
    const { data } = await worker.recognize(png);
    const info = extractMeetingInfo(data.text);
    results.push(info);
    console.log(`  [${v.name.padEnd(11)}] id=${info.meetingId || "-"}  pc=${info.passcode || "-"}`);
  }

  const merged = combineResults(results);
  console.log(
    "  --> combined:",
    JSON.stringify({
      meetingId: merged.meetingId,
      passcode: merged.passcode,
      confidence: merged.confidence,
      passcodeUnreadable: merged.passcodeUnreadable || false,
    })
  );
  console.log(
    "  --> launch  :",
    merged.meetingId ? buildJoinUrl("app", { ...merged, userName: "Towfiq" }) : "(no meeting id)"
  );

  const want = KNOWN[name];
  if (want) {
    const okId = merged.meetingId === want[0];
    const okPc = want[1] === null ? merged.passcode === "" : merged.passcode === want[1];
    const ok = okId && okPc;
    console.log(
      `  --> expected ${want[0]} / ${want[1] ?? "(unreadable)"}  ${ok ? "OK" : "*** MISMATCH ***"}`
    );
    if (!ok) failures++;
  }
}

await worker.terminate();
process.exitCode = failures ? 1 : 0;
