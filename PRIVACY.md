# Privacy

**Meeting Invite Scanner does not collect, store, or transmit any personal data.**

Use these answers verbatim in the Chrome Web Store, Microsoft Partner Center, and
addons.mozilla.org privacy forms.

## Data collection

- **No data is collected.** Nothing is sent off your device — there is no
  analytics, no telemetry, no error reporting, and no server of any kind.
- The images you load are read in the browser only, held in memory for the scan,
  and discarded when you close the popup. They are never uploaded.

## Permissions

| Permission | Why it's needed |
|---|---|
| `storage` | Remembers your **display name** locally (`storage.local` / `storage.sync`) so you don't retype it. That name is the only thing ever written to storage. |
| `wasm-unsafe-eval` (CSP) | Runs the bundled Tesseract.js OCR **WebAssembly** engine. It is required to instantiate the local `.wasm` core — it does **not** load or execute any remote code. |

## OCR / remote code

- OCR runs **entirely offline** using Tesseract.js, its WASM core, and the
  English language data — all three are **bundled in the extension package**
  (`vendor/`). Nothing is fetched at runtime.
- The manifest content security policy allows scripts only from `'self'` plus
  `'wasm-unsafe-eval'`, so the extension **cannot** load remote code even in
  principle.

## Contact

towfiq106+zoomext@gmail.com
