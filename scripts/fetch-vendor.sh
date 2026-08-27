#!/usr/bin/env bash
# Re-download the vendored Tesseract.js assets into vendor/.
# Only needed if you want to bump versions or restore missing files.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p vendor

TJS=5.1.1
CORE=5.1.1

dl() { echo "  $2"; curl -sL --fail --max-time 120 -o "$1" "$2"; }

dl vendor/tesseract.min.js                  "https://cdn.jsdelivr.net/npm/tesseract.js@${TJS}/dist/tesseract.min.js"
dl vendor/worker.min.js                     "https://cdn.jsdelivr.net/npm/tesseract.js@${TJS}/dist/worker.min.js"

# The worker is created with OEM 1 (LSTM_ONLY), so Tesseract only ever requests
# the *-lstm* core — simd-lstm where WASM SIMD is available, plain lstm otherwise.
for v in tesseract-core-simd-lstm tesseract-core-lstm; do
  dl "vendor/$v.wasm.js"  "https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE}/$v.wasm.js"
  dl "vendor/$v.wasm"     "https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE}/$v.wasm"
done

dl vendor/eng.traineddata.gz                "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz"

echo "done."
