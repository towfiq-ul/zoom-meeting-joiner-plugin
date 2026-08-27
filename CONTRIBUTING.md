# Contributing

Thanks for helping out. This is a small, no-build MV3 browser extension — the
repo folder loads directly as an unpacked extension.

## Setup

```
git clone git@github.com:towfiq-ul/zoom-meeting-joiner-plugin.git
cd zoom-meeting-joiner-plugin
npm install        # dev-only deps (icon renderer + OCR sample harness)
```

There is **no build step**. Load the folder as-is:

- **Chrome / Edge** — `chrome://extensions` → enable *Developer mode* →
  *Load unpacked* → pick this folder.
- **Firefox 121+** — `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on* → pick `manifest.json`.

Reload the extension from that page after each change.

## Project layout

The pipeline is four stages (`popup.js` orchestrates them):

```
preprocess.js  →  ocr.js  →  parser.js  →  combine.js
(canvas           (offline    (pure text     (weighted vote
 variants)         Tesseract)  → {id, pc})    across variants)
```

- `src/parser.js` and `src/combine.js` are **pure, DOM-free, and unit-tested** —
  keep them that way. New parsing/voting logic belongs here with tests.
- `src/preprocess.js` is Canvas code; `src/ocr.js` wraps the vendored Tesseract.
- `popup.html` / `popup.css` / `popup.js` are the UI and pipeline glue.

See `README.md` for the full architecture notes.

## Tests and checks

Ask before assuming any of these run in CI — run them locally before opening a PR:

| Check | Command |
|---|---|
| Unit tests (parser + combiner, no deps) | `npm test` |
| One test file | `node --test test/parser.test.mjs` |
| End-to-end OCR against `assets/` fixtures | `npm i --no-save tesseract.js@5.1.1 @napi-rs/canvas && npm run ocr:sample` |
| Firefox lint (scoped to shipped files) | `npm run lint` |
| Package a distributable zip | `npm run zip` |

New parser/combiner behaviour **must** come with a test in `test/`. The
`ocr:sample` harness asserts against known values in `scripts/ocr-sample.mjs`
(`KNOWN`); update those if you deliberately change pipeline output.

## Conventions

- **Parser glyph fixes**: only *unambiguous* OCR corrections (`O→0`, `l/I→1`).
  Never letter-shaped ones (`g/q/S/Z`) — they glue stray digits onto the meeting
  ID and break the 9–11 digit length check.
- **Passcodes** are kept verbatim (leading zeros preserved). If variants
  disagree on an unlabelled passcode, drop it rather than show a wrong one.
- **Cross-browser**: use `globalThis.browser ?? globalThis.chrome`. Test any
  `popup.js` change in both Chrome and Firefox.
- **No runtime network.** The manifest CSP is `'self'` + `'wasm-unsafe-eval'`
  only. Everything the extension needs is bundled.
- **`vendor/`** is pinned and committed. Don't hand-edit it — bump versions only
  via `scripts/fetch-vendor.sh` (`npm run vendor`) and say so in the PR.
- **Icons** are generated: change `scripts/make-icons.mjs`, then `npm run icons`
  and commit the regenerated PNGs. `icons/logo.svg` is the master mark.
- Match the surrounding code style; keep comments at the existing density.

## Pull requests

1. Branch off `master`.
2. Keep the change focused; note any `vendor/` or generated-file updates.
3. Make sure `npm test` and `npm run lint` pass (0 lint errors; the known
   minified-`vendor` warnings are expected).
4. If your change is user-facing, bump `version` in **both** `manifest.json` and
   `package.json` (keep them in sync).
5. Commit messages: short imperative subject, wrapped body explaining *why*.

## Publishing

Store submission is maintainer-only and documented in `PUBLISHING.md`.

## Licensing

By contributing you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license as the project.
