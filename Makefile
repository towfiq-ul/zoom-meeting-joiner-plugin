.PHONY: all help test test-one icons store-assets vendor ocr lint zip clean

NODE := node
NPM := npm

all: help

help: ## Show this help message.
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

test: ## Run all unit tests (parser + combiner, no deps).
	$(NPM) test

test-one: ## Run a single test file. Pass TEST_FILE=path/to/test.mjs.
	$(NODE) --test $(TEST_FILE)

icons: ## Regenerate extension icons from icons/logo.svg.
	$(NPM) run icons

store-assets: ## Generate store listing images (screenshots + promo tile).
	node scripts/store-assets.mjs

vendor: ## Re-download vendored OCR assets (Tesseract, WASM, traineddata).
	$(NPM) run vendor

ocr: ## Run end-to-end OCR against assets/ fixtures (needs dev deps installed).
	$(NPM) install --no-save tesseract.js@5.1.1 @napi-rs/canvas
	$(NPM) run ocr:sample

lint: ## Lint the extension with web-ext (scoped to files that ship in the zip).
	$(NPM) run lint

zip: lint ## Lint, then package dist/meeting-invite-scanner.zip — only extension files (manifest, popup.*, src, vendor, icons). No docs, scripts, tests, or deps.
	$(NPM) run zip

clean: ## Remove build artifacts.
	rm -rf dist

install: ## Install dependencies.
	$(NPM) install
