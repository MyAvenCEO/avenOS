# Headless extraction

Self-contained in this folder: one multimodal LLM call to extract either an **invoice** or a **bank statement** shape. Depends on **`google-genai`** (Gemini API) and **`PyMuPDF`**. This codebase does **not** import **`httpx`**; the official Gemini SDK may install it transitively for its own HTTP client.

## Install dependencies

Working directory should be **`ARCHIVE/ocr-example/`** (this folder—the one that contains **`run.py`** and **`requirements.txt`**).

Prefer a **dedicated virtual environment** so `pip install` does not mix this project with unrelated global packages (avoids noisy “dependency conflicts” warnings from tools like **aider** that pin older versions):

```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

**IDE:** Point **Python: default interpreter** at **`ARCHIVE/ocr-example/.venv/bin/python`** after you create that venv.

If you install into your **system** Python instead, **`ERROR: pip's dependency resolver...`** lines are usually harmless for this CLI unless something actually breaks at import or runtime—they reflect conflicts with **other** things already on that interpreter, not necessarily with **`google-genai`** itself.

## Configuration

Put **`GEMINI_API_KEY`** or **`GOOGLE_API_KEY`** in the **AvenOS repo root** **`.env`** (two levels up from this folder: **`../../.env`**). That file is loaded first (keys already in your shell win over the repo file); an optional **`ARCHIVE/ocr-example/.env`** overrides any earlier value for keys it defines. Format: **`KEY=value`** per line; lines starting with **`#`** are comments. **`extract_document()`** loads the same files on each call.

Alternatively set variables in the shell. From the monorepo root, **`bun run dev:ocr-example`** runs through Bun with **`--env-file=../../.env`** so the root env is in **`os.environ`** before Python starts.

| Variable | Role |
|----------|------|
| **`GEMINI_API_KEY`** / **`GOOGLE_API_KEY`** | Required for a live run (either name). |
| **`HEADLESS_MODEL`** | Gemini model id (default: **`gemini-3.1-flash-lite-preview`**). |
| **`GEMINI_TEMPERATURE`** | Sampling temperature (default **`1.0`**, per Gemini 3 guidance). |
| **`HEADLESS_MAX_VISION_PAGES`** | Maximum pages sent as images (default: **`10`**). |

Set **`HEADLESS_DOTENV_PARENT=1`** to also load **`.env`** from **`ARCHIVE/`** (between repo root and package-local; keys there override repo root, and package **`.env`** still wins last).
## Run (CLI)

From **`ARCHIVE/ocr-example/`**:

```bash
python run.py path/to/document.pdf
```

Outputs appear under **`.docs/run_<uuid>/`**: **`extracted.json`**, **`document.pdf`**, **`pages/*.png`**, and a copied **`original*`** file.

When not **`-q`**, **stderr** stays minimal: **`ingest · …`**, **`model · …`**, then every **5s** while the model call runs **`waiting · Ns`** (the model can take a long time — this is normal). After the API returns: **`done · Xs`** and then **JSON only on stdout**.

If you see **`model · …`** then nothing for minutes, the process is usually **still waiting on the Gemini API/network** (SSL stack in a traceback on interrupt is expected), not “missing” JSON. **`done`** and **`stdout` JSON** appear only after the API returns.

Optional flags:

- **`-q` / `--quiet`** — no stderr logging (JSON only on stdout when successful).
- **`--out path.json`** — copy **`extracted.json`** to another path (relative to your current directory).
- **`--run-dir path`** — use a fixed working directory instead of a new **`.docs/run_*`**.

## Import from Python

From **`ARCHIVE/ocr-example/`** (this directory on **`PYTHONPATH`**, or as cwd):

```bash
python -c "from run import extract_document; ..."
```

Or in code:

```python
from run import extract_document

extract_document("/path/to/invoice.pdf")
```

Loading **`__init__.py`** re-exports **`extract_document`** the same way, once this folder is imported as a package (e.g. path-based **`importlib`** setup); **`from run import extract_document`** is the straightforward path.

## What gets extracted

A single **`function_call`** — either **`extract_invoice`** or **`extract_bank_statement`**. Arguments follow the **`schema`** in **`doctypes/invoice.json`** and **`doctypes/bank_statement.json`** (full merged payload in one JSON object).

### `system_prompt` in vendored JSON (not used by this CLI)

The files **`doctypes/invoice.json`** and **`doctypes/bank_statement.json`** are kept aligned with **`../config/doctypes/`** so the tool **parameters schema** stays correct. Those files may still contain a **`system_prompt`** string — that block is aimed at **in-repo extraction** flows (e.g. invoice **second pass** omits **`vendor`** / **`buyer`** when parties are merged separately). **`run.py` does not read or send `system_prompt` to the model.**

Instructions for Gemini are **`HEADLESS_SYSTEM`** (+ user text / vision appendix) inside **`run.py`**. Headless tuning (full invoice with parties, bank statement columns, FX fields, …) belongs there—not in editing **`system_prompt`** inside the copied JSON unless you also change the upstream **`config/doctypes/*.json`** for the server.
