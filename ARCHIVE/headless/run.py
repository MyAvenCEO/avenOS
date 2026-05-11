"""Headless standalone extract: one multimodal LLM call, two tools (invoice / bank_statement).

No imports from parent `extraction/` package. Paths are relative to this file.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import shutil
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

PACKAGE_DIR = Path(__file__).resolve().parent
DOCTYPE_DIR = PACKAGE_DIR / "doctypes"

VISION_MAX_PAGES = int(os.environ.get("HEADLESS_MAX_VISION_PAGES", "10"))

_DEFAULT_MODEL = os.environ.get("HEADLESS_MODEL", "gemini-3.1-flash-lite-preview")


class HeadlessError(Exception):
    """User-facing extract failure."""


def strip_x_prefixed_keys(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {
            k: strip_x_prefixed_keys(v)
            for k, v in obj.items()
            if not (isinstance(k, str) and k.startswith("x-"))
        }
    if isinstance(obj, list):
        return [strip_x_prefixed_keys(x) for x in obj]
    return obj


def _clean_concatenated_iso_date_string(s: str) -> str:
    """Fix merged JSON tails on date fields, e.g.
    ``2026-03-05,fx_surcharge_eur:-1.46,description:`` → ``2026-03-05``.
    """
    t = s.strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", t)
    if not m:
        return s
    iso = m.group(1)
    tail = t[len(iso) :]
    if not tail:
        return iso
    if re.match(r",\s*[A-Za-z_][A-Za-z_0-9]*\s*:", tail) or re.match(
        r",\s*[A-Za-z_][A-Za-z_0-9]*\s*[,\{]", tail
    ):
        return iso
    return s


def _clean_concatenated_currency_string(s: str) -> str:
    """e.g. ``EUR,institution:{name:`` → ``EUR``."""
    t = s.strip()
    m = re.match(r"^([A-Z]{3})\b", t)
    if not m:
        return s
    code = m.group(1)
    rest = t[len(code) :]
    if rest.startswith(",") and re.search(r"[A-Za-z_{]", rest[1:]):
        return code
    return s


_FX_SURCHARGE_TAIL = re.compile(
    r"(?:currency_conversion_fee|fx_surcharge_eur):\s*(-?[0-9]+(?:[.,][0-9]+)?)",
    re.IGNORECASE,
)


def _salvage_merged_fx_surcharge_from_iso_field(
    tx: dict[str, Any], field: str = "booking_date"
) -> None:
    """If the model fused ``fx_surcharge_eur`` / legacy ``currency_conversion_fee`` into a date string."""
    bd = tx.get(field)
    if not isinstance(bd, str):
        return
    low = bd.lower()
    if "currency_conversion_fee" not in low and "fx_surcharge_eur" not in low:
        return
    mfee = _FX_SURCHARGE_TAIL.search(bd)
    if mfee is not None and tx.get("fx_surcharge_eur") is None:
        raw = mfee.group(1).replace(",", ".")
        try:
            tx["fx_surcharge_eur"] = float(raw)
        except ValueError:
            pass


def _migrate_legacy_currency_conversion_fee_key(tx: dict[str, Any]) -> None:
    """Model or old runs may still emit ``currency_conversion_fee``."""
    leg = tx.get("currency_conversion_fee")
    if leg is not None and tx.get("fx_surcharge_eur") is None:
        try:
            tx["fx_surcharge_eur"] = float(leg)
        except (TypeError, ValueError):
            tx["fx_surcharge_eur"] = leg
    if "currency_conversion_fee" in tx:
        del tx["currency_conversion_fee"]


def repair_bank_statement_extracted(obj: dict[str, Any]) -> dict[str, Any]:
    """Defensive fix for malformed scalar strings in bank_statement tool output."""
    txs0 = obj.get("transactions") if isinstance(obj, dict) else None
    if isinstance(txs0, list):
        for row in txs0:
            if isinstance(row, dict):
                _salvage_merged_fx_surcharge_from_iso_field(row, "booking_date")
                _salvage_merged_fx_surcharge_from_iso_field(row, "value_date")

    iso_keys = frozenset(
        {
            "period_start",
            "period_end",
            "statement_issue_date",
            "payment_due_date",
            "booking_date",
            "value_date",
        }
    )

    def walk(x: Any) -> Any:
        if isinstance(x, dict):
            out: dict[str, Any] = {}
            for k, v in x.items():
                ks = str(k)
                nv = walk(v)
                if isinstance(nv, str):
                    if ks in iso_keys:
                        nv = _clean_concatenated_iso_date_string(nv)
                    elif ks == "currency":
                        nv = _clean_concatenated_currency_string(nv)
                    elif ks == "booking_date_as_printed":
                        b = nv.strip()
                        if re.match(r"^(\d{1,2}\.\d{1,2}\.\d{2,4}),\s*[A-Za-z_]", b):
                            nv = b.split(",", 1)[0].strip()
                out[ks] = nv
            return out
        if isinstance(x, list):
            return [walk(i) for i in x]
        return x

    root = walk(obj)
    if isinstance(root, dict):
        txs1 = root.get("transactions")
        if isinstance(txs1, list):
            for row in txs1:
                if isinstance(row, dict):
                    _migrate_legacy_currency_conversion_fee_key(row)
    return root if isinstance(root, dict) else obj


def preview_dpi() -> int:
    return int(os.environ.get("OCR_PREVIEW_DPI", "120"))


def render_pdf_preview_pngs(
    pdf_path: Path,
    out_dir: Path,
    num_pages: int,
    *,
    dpi: int | None = None,
) -> list[str]:
    import pymupdf

    pages_dir = out_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    d = dpi if dpi is not None else preview_dpi()
    doc = pymupdf.open(pdf_path)
    try:
        n = min(len(doc), max(1, num_pages))
        names: list[str] = []
        for i in range(n):
            pix = doc[i].get_pixmap(dpi=d)
            fn = f"pages/{i + 1}.png"
            pix.save(out_dir / fn)
            names.append(fn)
        return names
    finally:
        doc.close()


def rasterize_document_pages(
    pdf_path: Path,
    out_dir: Path,
    *,
    dpi: int | None = None,
) -> tuple[list[dict[str, Any]], str, list[str]]:
    """Returns pages meta, combined markdown, preview relative paths."""
    import pymupdf

    d = dpi if dpi is not None else preview_dpi()
    doc = pymupdf.open(str(pdf_path))
    per_texts: list[str] = []
    try:
        n = len(doc)
        for i in range(n):
            t = doc[i].get_text() or ""
            per_texts.append(str(t).strip())
    finally:
        doc.close()
    if n == 0:
        return [], "", []
    preview_names = render_pdf_preview_pngs(pdf_path, out_dir, n, dpi=d)
    parts = [f"## Page {i + 1}\n\n{t}" for i, t in enumerate(per_texts)]
    combined_md = "\n\n".join(parts)
    pages: list[dict[str, Any]] = []
    for i, t in enumerate(per_texts):
        row: dict[str, Any] = {
            "page": i + 1,
            "text": t,
            "structured": {"source": "pymupdf", "text_chars": len(t)},
        }
        if i < len(preview_names):
            row["image"] = preview_names[i]
        pages.append(row)
    return pages, combined_md, preview_names


def normalize_input_to_pdf(src: Path, work_dir: Path) -> Path:
    """Copy PDF into work_dir or rasterize a single image to PDF via PyMuPDF."""
    import pymupdf as fitz

    work_dir.mkdir(parents=True, exist_ok=True)
    out = work_dir / "document.pdf"
    suf = src.suffix.lower()
    if suf == ".pdf":
        shutil.copy2(src, out)
        return out

    ft_map = {
        ".png": "png",
        ".jpg": "jpeg",
        ".jpeg": "jpeg",
        ".webp": "webp",
        ".tif": "tif",
        ".tiff": "tif",
    }
    ft = ft_map.get(suf)
    if not ft:
        raise HeadlessError(f"unsupported input suffix {suf!r} — use pdf or image png/jpeg/webp/tiff")

    raw = src.read_bytes()
    imgdoc = fitz.open(stream=raw, filetype=ft)
    try:
        pdfbytes = imgdoc.convert_to_pdf()
    finally:
        imgdoc.close()
    pdf = fitz.open(stream=pdfbytes, filetype="pdf")
    try:
        pdf.save(out.as_posix())
    finally:
        pdf.close()
    return out


def encode_vision_image_paths(paths: list[Path]) -> list[tuple[str, str]]:
    """Return [(mime, base64), ...]."""
    out: list[tuple[str, str]] = []
    for p in paths:
        data = p.read_bytes()
        suf = p.suffix.lower()
        if suf in (".jpg", ".jpeg"):
            mime = "image/jpeg"
        elif suf == ".webp":
            mime = "image/webp"
        else:
            mime = "image/png"
        b64 = base64.standard_b64encode(data).decode("ascii")
        out.append((mime, b64))
    return out


def build_gemini_tool() -> types.Tool:
    """Single Tool bundle with two function declarations (invoice vs bank statement)."""
    declarations: list[types.FunctionDeclaration] = []
    for tool_name, file in (
        ("extract_invoice", "invoice.json"),
        ("extract_bank_statement", "bank_statement.json"),
    ):
        data = json.loads((DOCTYPE_DIR / file).read_text(encoding="utf-8"))
        schema = data.get("schema")
        if not isinstance(schema, dict):
            raise HeadlessError(f"{file}: missing schema")
        params = strip_x_prefixed_keys(schema)
        declarations.append(
            types.FunctionDeclaration(
                name=tool_name,
                description=str(data.get("description") or tool_name),
                parameters_json_schema=params,
            )
        )
    return types.Tool(function_declarations=declarations)


VISION_ADDENDUM = (
    "The same document is attached as one full-page raster image per page, in reading order "
    "(the first image is page 1, then page 2, and so on). Use these images as the source of "
    "truth: read all visible text, numbers, addresses, and tables from the images. If a "
    "supplemental text block is present, it is optional and may be incomplete; prefer the images."
)

HEADLESS_SYSTEM = (
    "You are a document understanding engine. You MUST call exactly one function tool.\n\n"
    "Available tools:\n"
    "- **extract_invoice** — invoices, bills, receipts, payment demands (goods/services).\n"
    "- **extract_bank_statement** — account statements (Kontoauszug), posted transaction lists with "
    "balances, neobank activity for one account.\n\n"
    "Pick the tool that best matches the document. Fill **every** required field in the tool schema "
    "using page images and the extracted text below. Use null or empty arrays only when the document "
    "truly lacks that information.\n\n"
    "**Invoices** — Set **`header.document_kind`** to **`invoice`** for a typical commercial bill. "
    "Put **`header`**: **currency**, **invoice_number**, **order_number**, **customer_number**, dates "
    "(**issue_date**, **due_date**, **letter_date**), **referenced_invoice_numbers**, optional **`reference_entries`** "
    "(carrier/billing labels: **`kind`** + **`label`** + **`value`**; *Abrechnungsnummer* → **`billing_number`**, not **`customer_number`**). "
    "On the root: **`totals`** "
    "(**subtotal**, **tax_breakdown** each rate row: **tax_rate_percent** + **tax_amount**, "
    "**tax_total**, **invoice_total**), **`payments[]`** (all paid amounts; no duplicate roll-up field), "
    "and **total_outstanding**. **statements[]** holds only **line_items** / **line_groups** (and optional section headings). "
    "For each line: **quantity**, **quantity_unit**, **unit_price** (Einzelpreis), **title** + **description**, "
    "**amount**, **position**, **article_number** when columns exist. **Do not repeat** **title** text inside "
    "**description**; put indented sub-lines (**a.**/**b.**) only in **description** (multiline **\\n** OK). "
    "Include **vendor** and **buyer** from "
    "the letterhead. For **SEPA direct debit** / *Bankeinzug* text, fill **vendor.banking_accounts** "
    "(*Gläubiger-ID*, **sepa_mandate_reference**, **purpose** direct_debit_collection) and **buyer.banking_accounts** "
    "(debtor IBAN/BIC/bank, **purpose** sepa_debit_debtor), not only **payment_instructions**.\n\n"
    "**Bank statements** — Include **account_holder**, **institution**, **account_overview**, "
    "periods, balances, and **transactions**. **`booking_date`** / **`value_date`** as separate ISO fields; "
    "**`exchange_rate`** = **Kurs** (Umrechnungskurs); **`original_amount`**/**`original_currency`** = foreign "
    "**Betrag**/**Währung**; **`foreign_exchange_fee_percent`** = *1,75%* → **1.75**; **`fx_surcharge_eur`** = second EUR line (*% Währungsumrechnung*), not the Kurs; "
    "**`amount`** = total EUR. Never fuse keys into strings. "
    "**Credit/charge cards:** combine EUR + surcharge in **`amount`**; put surcharge in **`fx_surcharge_eur`**. "
    "Optionally **`booking_date_as_printed`** (*dd.mm.yy*).\n\n"
    "Semantic mapping: map printed labels to the exact JSON keys in the schema. "
    "Respond only via the tool call with valid JSON arguments."
)

HEADLESS_USER = (
    "Call exactly one of **extract_invoice** or **extract_bank_statement** with complete arguments."
)


def _gemini_user_parts(
    user_instruction: str,
    markdown: str,
    image_mime_b64: list[tuple[str, str]],
) -> list[types.Part]:
    inst = user_instruction.strip()
    if image_mime_b64:
        inst = f"{inst}\n\n{VISION_ADDENDUM.strip()}"
    text_body = (
        inst
        + "\n\n--- DOCUMENT_MARKDOWN START ---\n"
        + (markdown or "")
        + "\n--- DOCUMENT_MARKDOWN END ---"
    )
    parts: list[types.Part] = [types.Part.from_text(text=text_body)]
    for mime, b64 in image_mime_b64:
        raw = base64.standard_b64decode(b64)
        parts.append(types.Part.from_bytes(data=raw, mime_type=mime))
    return parts


def _gemini_api_key() -> str:
    k = (os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or "").strip()
    if not k:
        raise HeadlessError(
            "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set — export or use headless/.env."
        )
    return k


def _gemini_temperature() -> float:
    try:
        return float(os.environ.get("GEMINI_TEMPERATURE", "1.0"))
    except ValueError:
        return 1.0


def _parse_response_function_call(response: Any) -> tuple[str, dict[str, Any]]:
    cands = getattr(response, "candidates", None) or []
    if not cands:
        raise HeadlessError(f"no candidates in model response: {response!r}")
    content = cands[0].content
    if content is None:
        raise HeadlessError("empty candidate content")
    for part in content.parts or []:
        fc = getattr(part, "function_call", None)
        if fc is not None:
            name = fc.name
            args = fc.args
            if not isinstance(args, dict):
                args = dict(args) if args is not None else {}
            if not isinstance(name, str):
                raise HeadlessError(f"invalid function name: {name!r}")
            return name, args
    raise HeadlessError("no function_call in model response — adjust prompt or schema.")


def _usage_from_response(response: Any) -> tuple[int | None, int | None]:
    um = getattr(response, "usage_metadata", None)
    if um is None:
        return None, None
    pt = getattr(um, "prompt_token_count", None)
    ct = getattr(um, "candidates_token_count", None)
    try:
        pit = int(pt) if pt is not None else None
    except (TypeError, ValueError):
        pit = None
    try:
        cit = int(ct) if ct is not None else None
    except (TypeError, ValueError):
        cit = None
    return pit, cit


def gemini_generate_content(
    *,
    model: str,
    system_instruction: str,
    user_parts: list[types.Part],
    tool: types.Tool,
    progress: bool = False,
) -> Any:
    client = genai.Client(api_key=_gemini_api_key())
    cfg = types.GenerateContentConfig(
        system_instruction=types.Content(parts=[types.Part.from_text(text=system_instruction)]),
        temperature=_gemini_temperature(),
        thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.MINIMAL),
        tools=[tool],
        tool_config=types.ToolConfig(
            function_calling_config=types.FunctionCallingConfig(
                mode=types.FunctionCallingConfigMode.ANY,
                allowed_function_names=["extract_invoice", "extract_bank_statement"],
            ),
        ),
    )
    stop_hb = threading.Event()

    def _heartbeat() -> None:
        t0 = time.monotonic()
        while True:
            if stop_hb.wait(5.0):
                return
            _progress(f"waiting · {time.monotonic() - t0:.0f}s", enabled=progress)

    hb = threading.Thread(target=_heartbeat, name="headless-gemini-hb", daemon=True)
    if progress:
        hb.start()
    try:
        return client.models.generate_content(
            model=model,
            contents=[types.Content(role="user", parts=user_parts)],
            config=cfg,
        )
    finally:
        stop_hb.set()


def _stderr_line(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def _progress(msg: str, *, enabled: bool) -> None:
    if not enabled:
        return
    _stderr_line(f"headless: {msg}")


def extract_document(
    input_path: str | Path,
    *,
    run_dir: Path | None = None,
    progress: bool = True,
) -> dict[str, Any]:
    """Ingest document → one LLM call → merged JSON.

    With ``progress=True`` (default): ingest and model lines, then optionally **every 5s**
    ``waiting · Ns`` while the Gemini ``generate_content`` call runs, then ``done · …``. Use
    ``progress=False`` or CLI ``--quiet`` for none.

    Returns a dict with ``tool_name``, ``extracted``, ``model``, ``elapsed_ms``, ``run_dir``,
    ``extracted_json_path``.
    """
    src = Path(input_path).expanduser().resolve()
    if not src.is_file():
        raise HeadlessError(f"not a file: {src}")

    mid = _DEFAULT_MODEL
    work = run_dir or (PACKAGE_DIR / ".docs" / f"run_{uuid.uuid4().hex}")
    work.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(src, work / f"original{src.suffix.lower()}")
    except OSError:
        pass

    t0 = time.time()
    pdf = normalize_input_to_pdf(src, work)
    _pages, combined_md, preview_names = rasterize_document_pages(pdf, work)
    rel_preview = preview_names[:VISION_MAX_PAGES]
    vpaths = [work / rel for rel in rel_preview]
    vision_payload = encode_vision_image_paths(vpaths)
    n_vis = len(vision_payload)
    _progress(
        f"ingest · {n_vis} page(s) for vision" if n_vis else "ingest · empty PDF",
        enabled=progress,
    )
    tool = build_gemini_tool()
    user_parts = _gemini_user_parts(HEADLESS_USER, combined_md, vision_payload)

    _progress(f"model · {mid}", enabled=progress)
    response = gemini_generate_content(
        model=mid,
        system_instruction=HEADLESS_SYSTEM,
        user_parts=user_parts,
        tool=tool,
        progress=progress,
    )
    tool_name, extracted = _parse_response_function_call(response)
    if not isinstance(tool_name, str) or tool_name not in ("extract_invoice", "extract_bank_statement"):
        raise HeadlessError(f"unexpected tool_name: {tool_name!r}")
    if not extracted:
        raise HeadlessError("empty tool arguments — check model output.")
    if isinstance(extracted, dict):
        extracted = strip_x_prefixed_keys(extracted)
        if tool_name == "extract_bank_statement":
            extracted = repair_bank_statement_extracted(extracted)

    pt, ct = _usage_from_response(response)
    elapsed = int((time.time() - t0) * 1000)

    out_path = work / "extracted.json"
    payload_out = {
        "tool_name": tool_name,
        "extracted": extracted,
        "model": mid,
        "elapsed_ms": elapsed,
        "prompt_tokens": pt,
        "completion_tokens": ct,
        "run_dir": str(work),
        "source_file": str(src),
        "vision_pages_used": len(vision_payload),
    }
    out_path.write_text(json.dumps(payload_out, ensure_ascii=False, indent=2), encoding="utf-8")

    payload_out["extracted_json_path"] = str(out_path)
    _progress(f"done · {float(elapsed) / 1000.0:.2f}s", enabled=progress)
    return payload_out


def _load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and value and key not in os.environ:
            os.environ[key] = value


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Headless standalone extract (invoice vs bank_statement).")
    p.add_argument("input", type=Path, help="PDF or image path")
    p.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Write result JSON copy to this path in addition to .docs/",
    )
    p.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Use this work directory instead of a new .docs/run_*",
    )
    p.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="No stderr progress or timing (JSON only on stdout when successful).",
    )
    args = p.parse_args(list(argv) if argv is not None else None)

    _load_dotenv(PACKAGE_DIR / ".env")
    if os.environ.get("HEADLESS_DOTENV_PARENT", "").strip().lower() in {"1", "true", "yes"}:
        _load_dotenv(PACKAGE_DIR.parent / ".env")

    try:
        res = extract_document(
            args.input,
            run_dir=args.run_dir,
            progress=not args.quiet,
        )
    except HeadlessError as e:
        print(f"headless: error: {e}", flush=True)
        return 2

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(Path(res["extracted_json_path"]), args.out)

    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
