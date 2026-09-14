<img src="icons/logo.svg" alt="Meeting Invite Scanner logo" width="64" />

# Meeting Invite Scanner

*Unofficial. Not affiliated with, endorsed by, or sponsored by Zoom Video
Communications, Inc.* See [PRIVACY.md](PRIVACY.md) for data handling.

A browser extension that reads a **screenshot or photo of a Zoom invite**, extracts the
**meeting ID** and **passcode** with on-device OCR, and opens the meeting in the
**desktop app** or the **web client** with your display name pre-filled.

Everything runs locally — the vendored Tesseract.js engine, WASM core and English
language data are bundled in the extension, so no image ever leaves your machine.

## How it works

```
                 ┌─ full frame      ┐
invite image ──▶ ├─ full + de-moiré ┤─▶ Tesseract.js ─▶ parser ─▶ per-variant
(preprocess.js)  ├─ upper 60%       │      OCR        (parser.js)  { id, passcode }
                 ├─ upper + blur    │                                    │
                 └─ middle band     ┘                    combine.js — weighted vote
                                                                        │
                                    { meetingId: "89366126292", passcode: "017970" }
                                                                        │
                  ┌─────────────────────────────────────────────────────┴──────┐
            "Join in app"                                            "Join in browser"
  zoommtg://zoom.us/join?confno=…                        https://app.zoom.us/wc/<id>/join?…
        &pwd=…&uname=Towfiq                                            &pwd=…
```

Phone photos of a screen are the hard case (bezel, keyboard, moiré, faint text),
so the popup runs OCR on **several cleaned-up variants** and takes a **weighted
majority vote**. Each variant is: pure-black borders trimmed, then a fixed region
(whole frame / top 60% / middle band) → grayscale → **Lanczos-3 upscale** (Canvas
bilinear smears small text) → **percentile contrast stretch** (absolute min/max
is a no-op on a photo) → unsharp mask, with an optional de-moiré blur first.

- **Meeting ID** is normalised to digits only; spaced (`893 6612 6292`) and
  dash-separated forms are handled, and only unambiguous OCR glyph swaps
  (`O→0`, `l/I→1`) are corrected — never letter-shaped ones, which would glue a
  stray digit onto the number. A shorter misread that's a prefix of a longer
  read folds into it (`8936612629` → `89366126292`).
- **Passcode** is kept verbatim, so a leading zero like `017970` is preserved.
  Recovered even when Zoom's "Meeting passcode:" caption is cropped off. If the
  variants disagree on an unlabelled passcode it's **left blank** rather than
  guessed wrong — the popup then says to type it in.
- Full `zoom.us/j/<id>?pwd=…` links in the image are parsed directly when present.
- **Drag-to-crop**: if a photo is too rough, drag a box over the ID or passcode
  in the popup preview and hit *Scan selection* — OCR re-runs on just that
  region, which is far more reliable.

## Install (developer / unpacked)

The project is already a loadable extension — no build step required. Icons are
checked in; regenerate them only if you change `scripts/make-icons.mjs`.

### Chrome / Edge
1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder.

### Firefox
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on…** → select `manifest.json`.
   (Temporary add-ons are removed on restart; a permanent install must be signed
   via addons.mozilla.org.)

## Usage

1. Click the toolbar icon.
2. Set **Your display name** (defaults to `Towfiq`, remembered between sessions).
3. Drop / choose / paste (`Ctrl`/`⌘`+`V`) an image of the invite.
4. Wait for OCR (a few seconds per variant), check the detected **Meeting ID** /
   **Passcode** — the fields are editable, and the raw OCR text per variant is
   under "OCR text". If a value is wrong, drag a box over it in the preview and
   click **Scan selection**.
5. Click **Join meeting…** — a confirmation modal shows the ID / passcode / name
   and asks **Installed app** or **Browser**; nothing opens until you choose.
   **Copy app link** copies the `zoommtg://` URL.

## Known limitations

- **Web client name**: Zoom's web client has no URL parameter for a *guest*
  display name — it still prompts unless you're signed in to zoom.us. `uname`
  only reliably pre-fills the **desktop app**.
- First OCR run initialises the WASM engine (~1–3 s); with ~5 variants a photo
  takes roughly 8–20 s total. It stops early once the reads agree strongly.
- Accuracy drops on skewed / low-light / heavy-moiré photos — a straight-on
  screenshot is near-perfect, an angled phone photo of a monitor may get the ID
  but not the passcode. Use **Scan selection** or just edit the fields.
- The desktop-app button relies on the OS `zoommtg://` protocol handler that the
  Zoom client registers on install.

## Development

| Task | Command |
|------|---------|
| Parser + combiner unit tests (no deps) | `npm test` (`node --test`) |
| End-to-end OCR on your own invite image(s) | `npm i --no-save tesseract.js@5.1.1 @napi-rs/canvas && node scripts/ocr-sample.mjs <image>…` |
| Regenerate icons | `npm run icons` |
| Generate store listing images | `make store-assets` (or `node scripts/store-assets.mjs`) |
| Re-download vendored OCR assets | `npm run vendor` |
| Package a `.zip` | `npm run zip` |

`scripts/ocr-sample.mjs` runs the **real** `src/preprocess.js` Canvas code (via a
`@napi-rs/canvas` shim) plus the offline engine, parser and combiner, against
image paths you pass on the command line:

```
node scripts/ocr-sample.mjs ~/Pictures/zoom-invite.jpeg
```

**No sample invites are committed** — invite screenshots contain real meeting
credentials. Drop your own into a local (git-ignored) `assets/` folder, or point
the script straight at a file. If a passed file's basename matches a key in the
`KNOWN` map in `scripts/ocr-sample.mjs`, the run also asserts the expected
ID / passcode.

## Layout

```
manifest.json              MV3, works in Chrome/Edge/Firefox 121+
popup.html / .css / .js     UI, drag-to-crop selector, confirm modal, pipeline glue
src/preprocess.js           Canvas cleanup: black-border trim, Lanczos resample,
                            percentile stretch, unsharp -> full/upper/mid variants
src/ocr.js                  recognizeText() — offline Tesseract.js, PSM 3
src/parser.js               extractMeetingInfo(), formatMeetingId(), buildJoinUrl()
src/combine.js              combineResults() — weighted vote, prefix-fold, passcode guard
vendor/                     bundled OCR engine (no runtime network)
icons/                      logo.svg (master) + generated icon-{16,48,128}.png
scripts/                    make-icons.mjs, fetch-vendor.sh, ocr-sample.mjs
test/                       node:test unit tests (parser + combine)
```

Put your own invite images in a local `assets/` folder for `ocr-sample.mjs` —
it's git-ignored and never committed.

- `src/parser.js` and `src/combine.js` are pure and dependency-free (23 unit
  tests, incl. OCR-noise, tie-break and passcode-guard scenarios).
- `vendor/` — pinned Tesseract.js 5.1.1 + LSTM WASM cores 5.1.1 + `eng`
  traineddata (4.0.0). `scripts/ocr-sample.mjs` reuses `vendor/eng.traineddata.gz`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, tests, and conventions.

## License

[Apache License 2.0](LICENSE) © 2026 Towfiqul Islam. The vendored Tesseract.js
assets under `vendor/` keep their own upstream licenses (Apache-2.0).
