---
name: extract
description: Extract structured data from documents - OCR, parsing, and dossier creation
---

# Extract Skill

This skill extracts usable text and simple entities from archived documents.

It is designed to operate through a short-lived sandbox worker that receives an
archive key, analyzes the file first, and then uses shell tools tactically to
recover the best available text safely.

## When to Use Extract

- Document needs content extraction
- Image needs OCR
- PDF needs text extraction
- Structured entities need to be identified
- You want the worker to inspect an archived file inside the sandbox and return text for downstream reasoning

## Current Runtime Reality

- Extract workers are **short-lived sandbox executions**.
- Supported operations are:
  - `extract-text`
  - `extract-entities`
- The runtime reads the archived file from Jaensen storage using an archive key.
- The sandbox process can also access the configured document directory read-only at `/documents`.
- The extractor first performs **file analysis** before choosing an extraction strategy.
- The extractor now performs **real PDF text extraction** when PDF tooling is available in the sandbox.
- The extractor now performs **OCR on supported image files** when `tesseract` is available in the sandbox.
- Worker output is truncated so binary junk or very large payloads do not flood the rest of the system.

### Workflow
1. Receive an archive key
2. Run a sandbox worker against the archived file path under `/documents`
3. Analyze the file with system tooling before choosing an extraction tactic
4. Extract text safely with bounded output
5. Return extracted text or simple entities to the intent/runtime

### Worker Type
- The sandbox worker type currently matches the selected operation name.

## Worker Capabilities

### `extract-text`
Extract text from an archived document.

**Input:**
- `archiveKey` or `key`: Archive key from ingest/storage
- optional `contentType`: Helps the runtime choose the right extraction command

**Output:**
- Extracted text
- Worker execution details for audit/debugging

**Current extraction behavior by format:**
- **All files**: the worker first uses `file` to inspect the MIME type / file description before taking action
- **PDF**: the worker uses a shell loop and tries multiple commands in order until it finds meaningful invoice/document-like text:
  1. `pdftotext -layout`
  2. `pdftotext`
  3. `pdfinfo`
  4. `strings`
- **Images** (`png`, `jpeg`, etc.): the worker uses `tesseract` OCR when available
- **HTML**: strips tags with a simple `sed`-based pass
- **Plain text / markdown / JSON / CSV**: returns file contents directly
- **Unknown binary formats**: does not dump raw bytes into the system; instead it returns a safe fallback message
- **Long outputs**: are truncated to a safe maximum size before being returned

### `extract-entities`
Extract simple entities from extracted text.

**Input:**
- `archiveKey` or `key`: Archive key from ingest/storage
- optional `contentType`

**Output:**
- Extracted text
- A simple unique list of capitalized entity-like tokens

**Current entity behavior:**
- Uses the extracted text as input
- Applies a lightweight heuristic regex
- Optimized for speed and inspectability, not deep NLP accuracy

## Supported Formats

- Plain text, markdown, JSON, HTML, CSV: text extraction is implemented
- PDF: text extraction is implemented via sandbox shell tools, with multi-step fallback attempts
- PNG / JPEG and similar images: OCR extraction is implemented when `tesseract` is available
- Images / scans may still vary in quality depending on screenshot clarity, scan quality, and OCR performance
- Other binary formats: return a safe fallback when no implemented extractor exists

## Operational Notes

- The extractor depends on the sandbox environment having the needed CLI tools available.
- The extractor intentionally avoids blindly `cat`-ing unknown binary files into downstream prompts.
- PDF extraction quality depends on the source PDF and the installed tools.
- OCR quality depends heavily on image quality, layout, language, and screenshot cleanliness.
- The runtime prefers real worker output when it looks meaningful; otherwise it falls back to basic in-process extraction for simpler text formats.
- `/documents` is mounted read-only for the worker when a document directory is configured.
- This means the extractor can do real shell-driven investigation of archived files without mutating the source documents.
- Worker stdout/stderr included in results are truncated to keep the system stable and readable.

## Notes

- The current entity extraction is heuristic and intentionally simple.
- No dossier persistence is implemented yet.
- In practice, ingest can automatically queue extract after a successful archive step.
- OCR exists now for supported image files, but there is still plenty of room to improve preprocessing and extraction quality.
- Skill docs should reflect runtime reality: PDF extraction and basic image OCR are now supported.