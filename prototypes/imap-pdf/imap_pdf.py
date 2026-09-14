#!/usr/bin/env python3
"""Read-only IMAP PDF import prototype. Python 3.11+, standard library only."""

from __future__ import annotations

import argparse
import base64
import contextlib
import datetime as dt
import email.policy
import email.utils
import fcntl
import getpass
import hashlib
import html
import imaplib
import json
import os
from pathlib import Path
import re
import ssl
import sys
import tempfile
import io
from email.message import EmailMessage
from email.parser import BytesParser

MIB = 1024 * 1024
CHUNK = 256 * 1024
DEFAULT_OUTPUT = Path(globals().get("__file__", "imap_pdf.py")).resolve().parent / "output"


class ImportFailure(Exception):
    """A safe, user-facing failure; never include server responses or credentials."""


class ProtocolFailure(ImportFailure):
    """The connection cannot safely be reused after this response."""


class BoundedIMAP(imaplib.IMAP4_SSL):
    """Cap literals and accumulated response bytes before imaplib allocates them."""

    budget = 4 * MIB

    def read(self, size):
        if size > CHUNK or size > self.budget:
            raise ProtocolFailure("Server response exceeded the download bound. Narrow the date range.")
        self.budget -= size
        return super().read(size)

    def readline(self):
        line = super().readline()
        self.budget -= len(line)
        if self.budget < 0:
            raise ProtocolFailure("Server response exceeded the search bound. Narrow the date range.")
        return line


def command(client, method, *args, **kwargs):
    client.budget = 4 * MIB
    status, data = getattr(client, method)(*args, **kwargs)
    if status != "OK":
        raise ImportFailure(f"IMAP {method.upper()} failed. Check mailbox name and account access.")
    return data


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def identity_key(source: dict) -> str:
    return digest(json.dumps(source, sort_keys=True, ensure_ascii=True).encode())


def clean_text(value) -> str:
    return "".join(c if c.isprintable() else " " for c in str(value or ""))[:1000]


def quoted(value: str) -> str:
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ImportFailure("Connection fields must not contain control characters.")
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def encode_mailbox(value: str) -> str:
    """IMAP modified UTF-7, without enabling UTF8=ACCEPT server extensions."""
    result, pending = [], []

    def flush():
        if pending:
            encoded = base64.b64encode("".join(pending).encode("utf-16-be")).decode()
            result.append("&" + encoded.rstrip("=").replace("/", ",") + "-")
            pending.clear()

    for char in value:
        if " " <= char <= "~":
            flush()
            result.append("&-" if char == "&" else char)
        else:
            pending.append(char)
    flush()
    return "".join(result)


def decode_mailbox(value: bytes) -> str:
    def replace(match):
        text = match.group(1)
        if not text:
            return "&"
        padded = text.replace(",", "/") + "=" * (-len(text) % 4)
        return base64.b64decode(padded).decode("utf-16-be")
    return re.sub(r"&([^-]*)-", replace, value.decode("ascii"))


def list_mailboxes(client) -> list[str]:
    result = []
    for row in command(client, "list"):
        if not row:
            continue
        prefix, literal = row if isinstance(row, tuple) else (row, None)
        match = re.match(rb'^\(([^)]*)\)\s+(?:NIL|"(?:\\.|[^"\\])*")\s+(.+)$', prefix)
        if not match or b"\\noselect" in match[1].lower():
            continue
        name = literal if literal is not None else match[2]
        if literal is None and name.startswith(b'"') and name.endswith(b'"'):
            name = re.sub(rb"\\(.)", rb"\1", name[1:-1])
        result.append(decode_mailbox(name))
    return result


def atomic_write(path: Path, content: bytes):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def write_json(path: Path, value):
    atomic_write(path, (json.dumps(value, indent=2, ensure_ascii=True) + "\n").encode())


@contextlib.contextmanager
def output_lock(output: Path):
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    if output.is_symlink() or output.stat().st_uid != os.getuid():
        raise ImportFailure("Choose an output directory owned by your user, without a symlink.")
    os.chmod(output, 0o700)
    with (output / ".lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ImportFailure("Another import is using this output directory.") from None
        yield


def download_message(client, uid: str, max_bytes: int) -> bytes:
    metadata = command(client, "uid", "FETCH", uid, "(UID RFC822.SIZE)")
    size = None
    for row in metadata:
        if isinstance(row, bytes):
            uid_match = re.search(rb"\bUID (\d+)\b", row)
            size_match = re.search(rb"\bRFC822.SIZE (\d+)\b", row)
            if uid_match and uid_match[1].decode() == uid and size_match:
                size = int(size_match[1])
    if size is None:
        raise ImportFailure("Message disappeared or its size could not be read.")
    if size > max_bytes:
        raise ImportFailure("Message exceeds the raw-message byte limit.")
    if size == 0:
        raise ImportFailure("Message is empty.")
    raw = bytearray()
    while len(raw) < size:
        offset = len(raw)
        count = min(CHUNK, size - offset)
        rows = command(client, "uid", "FETCH", uid, f"(UID BODY.PEEK[]<{offset}.{count}>)")
        chunks = [row for row in rows if isinstance(row, tuple)]
        if len(chunks) != 1:
            raise ImportFailure("Message download was incomplete. Run the import again.")
        header, chunk = chunks[0]
        # Servers may place UID after the body literal, regardless of request order.
        response_fields = b" ".join(row[0] if isinstance(row, tuple) else row
                                    for row in rows if isinstance(row, (bytes, tuple)))
        uid_match = re.search(rb"\bUID (\d+)\b", response_fields)
        body_match = re.search(rb"BODY\[\]<(\d+)>", header, re.I)
        if (not uid_match or uid_match[1].decode() != uid or not body_match
                or int(body_match[1]) != offset or len(chunk) != count):
            raise ProtocolFailure("Server returned an unexpected or truncated message chunk.")
        raw.extend(chunk)
    return bytes(raw)


def extract_pdfs(raw: bytes, max_pdf_bytes: int) -> tuple[dict, list[dict], list[str]]:
    message = BytesParser(policy=email.policy.default).parsebytes(raw)
    metadata = {name: clean_text(message.get(name)) for name in ("From", "To", "Subject", "Date", "Message-ID")}
    attachments, issues = [], []
    stack = [(message, "1", 0)]
    count = 0
    while stack:
        part, path, depth = stack.pop()
        count += 1
        if count > 1000 or depth > 30:
            issues.append("MIME structure exceeds 1,000 parts or 30 nested levels.")
            break
        if part.defects:
            issues.append(f"Part {path}: malformed MIME ({', '.join(type(d).__name__ for d in part.defects)}).")
        if part.is_multipart():
            children = list(part.iter_parts())
            stack.extend((child, f"{path}.{i + 1}", depth + 1) for i, child in reversed(list(enumerate(children))))
            continue
        filename = clean_text(part.get_filename())
        media_type = part.get_content_type()
        candidate = media_type == "application/pdf" or filename.lower().endswith(".pdf")
        # Check octet-stream parts too, including missing and incorrect filenames.
        if not candidate and media_type != "application/octet-stream":
            continue
        content = part.get_payload(decode=True) or b""
        if part.defects:
            issues.append(f"Part {path}: cannot safely decode this MIME part.")
            continue
        is_pdf = b"%PDF-" in content[:1024]
        if not is_pdf:
            if candidate:
                issues.append(f"Part {path}: PDF candidate has no PDF signature.")
            continue
        if len(content) > max_pdf_bytes:
            issues.append(f"Part {path}: PDF exceeds the attachment byte limit.")
            continue
        attachments.append({
            "part": path, "filename": filename or f"attachment-{path}.pdf",
            "declaredMediaType": media_type, "disposition": part.get_content_disposition(),
            "sha256": digest(content), "bytes": len(content), "content": content,
        })
    return metadata, attachments, issues


def import_message(output: Path, source: dict, raw: bytes, max_pdf_bytes: int) -> dict:
    key = identity_key(source)
    previous_path = output / "records" / f"{key}.json"
    observed_at = dt.datetime.now(dt.timezone.utc).isoformat()
    if previous_path.exists():
        try:
            observed_at = json.loads(previous_path.read_text()).get("observedAt", observed_at)
        except ValueError:
            pass
    raw_path = Path("messages") / f"{key}.eml"
    atomic_write(output / raw_path, raw)
    metadata, attachments, issues = extract_pdfs(raw, max_pdf_bytes)
    for attachment in attachments:
        content = attachment.pop("content")
        relative = Path("pdfs") / f"{attachment['sha256']}.pdf"
        target = output / relative
        if not target.exists() or target.stat().st_size != len(content) or digest(target.read_bytes()) != attachment["sha256"]:
            atomic_write(target, content)
        attachment["path"] = relative.as_posix()
        attachment["occurrenceId"] = identity_key({"message": key, "part": attachment["part"]})
    record = {
        "version": 1, "id": key, "source": source, "headers": metadata,
        "observedAt": observed_at,
        "rawPath": raw_path.as_posix(), "rawSha256": digest(raw), "rawBytes": len(raw),
        "attachments": attachments, "issues": issues,
    }
    write_json(output / "records" / f"{key}.json", record)
    return record


def cached_message(output: Path, source: dict, max_bytes: int) -> bytes | None:
    key = identity_key(source)
    record_path = output / "records" / f"{key}.json"
    raw_path = output / "messages" / f"{key}.eml"
    if not record_path.exists() or not raw_path.exists() or raw_path.stat().st_size > max_bytes:
        return None
    try:
        record = json.loads(record_path.read_text())
        raw = raw_path.read_bytes()
        if record["source"] == source and record["rawSha256"] == digest(raw):
            return raw
    except (ValueError, KeyError):
        pass
    return None


def write_report(output: Path, run: dict):
    records = [json.loads(p.read_text()) for p in sorted((output / "records").glob("*.json"))]
    write_json(output / "manifest.json", {"version": 1, "lastRun": run, "messages": records})
    rows = []
    for record in records:
        title = html.escape(record["headers"]["Subject"] or "(No subject)")
        sender = html.escape(record["headers"]["From"])
        attachments = "".join(
            f'<li><a href="{a["path"]}">{html.escape(a["filename"])}</a> '
            f'({a["bytes"]:,} bytes; part {a["part"]})</li>' for a in record["attachments"])
        warnings = "".join(f"<li>{html.escape(issue)}</li>" for issue in record["issues"])
        rows.append(f'<article><h2>{title}</h2><p>{sender}</p>'
                    f'<p><a href="{record["rawPath"]}">Source email</a> · '
                    f'{html.escape(record["source"].get("mailbox", "Local sample"))}</p>'
                    f'<ul>{attachments or "<li>No PDF attachments found.</li>"}</ul>'
                    f'<ul class="issues">{warnings}</ul></article>')
    failures = "".join(f"<li>{html.escape(item)}</li>" for item in run["failures"])
    page = ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'
            '<title>IMAP PDF import</title><style>'
            'body{font:16px/1.6 system-ui;margin:48px auto;padding:0 24px;max-width:900px;background:#f3f5f7;color:#16212b}'
            'h1{font-size:36px;line-height:1.2}h2{font-size:20px}article{background:white;padding:20px 28px;margin:20px 0;border-radius:12px}'
            'a{color:#125c96;overflow-wrap:anywhere}.issues{color:#914019}small{color:#52616d}'
            '</style><h1>PDFs from your email</h1>'
            f'<p>Last run: {run["processed"]} messages processed, {run["cached"]} reused from local storage, '
            f'{len(run["failures"])} failures.</p><ul class="issues">{failures}</ul>'
            '<small>All retained imports in this folder. Email content is not rendered. '
            'PDF signatures are checked; PDF contents are not validated or scanned. '
            'This prototype stores files locally and does not submit them to avenOS or an AI provider.</small>'
            + "".join(rows) + '</html>')
    atomic_write(output / "report.html", page.encode())


def demo_messages() -> list[bytes]:
    # A small, valid one-page PDF, generated without another runtime or library.
    stream = b"BT /F1 18 Tf 50 100 Td (IMAP attachment demo) Tj ET"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 180] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
               b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
               f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream"]
    pdf, offsets = bytearray(b"%PDF-1.4\n"), [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{i} 0 obj\n".encode() + obj + b"\nendobj\n")
    start = len(pdf)
    pdf.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode())
    result = []
    for i in range(2):
        message = EmailMessage()
        message["From"] = "Demo Supplier <supplier@example.test>"
        message["To"] = "tester@example.test"
        message["Subject"] = ["Your sample PDF", "Same PDF, another email"][i]
        message["Message-ID"] = f"<imap-demo-{i}@example.test>"
        message.set_content("Synthetic example. No mailbox connection was made.")
        message.add_attachment(bytes(pdf), maintype="application", subtype="pdf", filename="sample-invoice.pdf")
        message.set_boundary(f"aven-imap-demo-{i}")
        result.append(message.as_bytes(policy=email.policy.SMTP))
    return result


def date_arg(value):
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Use a date such as 2026-09-01.") from None


def imap_date(value):
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    return f"{value.day:02}-{months[value.month - 1]}-{value.year}"


def options(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    parser.add_argument("--host", help="IMAP hostname; prompted when omitted")
    parser.add_argument("--port", type=int, default=993)
    parser.add_argument("--user", help="Mailbox login; prompted when omitted")
    parser.add_argument("--mailbox", default="INBOX")
    parser.add_argument("--list-mailboxes", action="store_true")
    parser.add_argument("--since", type=date_arg, help="Inclusive received date (server mailbox date)")
    parser.add_argument("--before", type=date_arg, help="Exclusive received date (server mailbox date)")
    parser.add_argument("--max-messages", type=int, default=50, help="Most recent matching UIDs per invocation")
    parser.add_argument("--max-message-mib", type=int, default=32, help="Raw email size limit, including MIME encoding")
    parser.add_argument("--max-pdf-mib", type=int, default=20)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--ca-file", help="Optional PEM trust bundle; hostname verification stays enabled")
    parser.add_argument("--demo", action="store_true", help="Import two synthetic emails without connecting")
    parser.add_argument("--eml", type=Path, action="append", help="Import a saved email without connecting; repeatable")
    args = parser.parse_args(argv)
    if args.demo and args.eml:
        parser.error("Choose --demo or --eml.")
    if not 1 <= args.port <= 65535 or not 1 <= args.max_messages <= 10000:
        parser.error("Port must be 1–65535; max-messages must be 1–10000.")
    if not 1 <= args.max_message_mib <= 128 or not 1 <= args.max_pdf_mib <= 128:
        parser.error("Byte limits must be between 1 and 128 MiB.")
    if args.since and args.before and args.since >= args.before:
        parser.error("--since must precede --before.")
    return args


def connect(args):
    for name, label in (("host", "IMAP hostname"), ("user", "Mailbox login")):
        if not getattr(args, name):
            if not sys.stdin.isatty():
                raise ImportFailure(f"Supply --{name} when running without a terminal.")
            setattr(args, name, input(f"{label}: ").strip())
        if not getattr(args, name):
            raise ImportFailure(f"{label} must not be empty.")
        quoted(getattr(args, name))
    quoted(args.mailbox)
    secret = getattr(args, "password", None) or os.environ.get("IMAP_PASSWORD")
    token = os.environ.get("IMAP_ACCESS_TOKEN")
    if secret and token:
        raise ImportFailure("Set only one of IMAP_PASSWORD and IMAP_ACCESS_TOKEN.")
    if not secret and not token:
        if not sys.stdin.isatty():
            raise ImportFailure("Run in a terminal for a hidden password prompt, or set IMAP_PASSWORD / IMAP_ACCESS_TOKEN.")
        secret = getpass.getpass("IMAP password or app password (not saved): ")
    context = ssl.create_default_context(cafile=args.ca_file)
    client = BoundedIMAP(args.host, args.port, ssl_context=context, timeout=30)
    client.debug = 0
    try:
        if token:
            if any(c in args.user + token for c in "\x00\x01\r\n"):
                raise ImportFailure("Invalid OAuth authentication fields.")
            payload = f"user={args.user}\x01auth=Bearer {token}\x01\x01".encode()
            command(client, "authenticate", "XOAUTH2", lambda challenge: b"" if challenge else payload)
        else:
            command(client, "login", quoted(args.user), secret)
    except BaseException:
        client.shutdown()
        raise
    return client


def run(args) -> int:
    output = args.output.expanduser().absolute()
    max_raw, max_pdf = args.max_message_mib * MIB, args.max_pdf_mib * MIB
    report = {"processed": 0, "cached": 0, "failures": [], "messageIds": []}
    with contextlib.ExitStack() as stack:
        client = None
        if not args.demo and not args.eml:
            client = connect(args)
            stack.callback(client.shutdown)
            if args.list_mailboxes:
                for name in list_mailboxes(client):
                    print(clean_text(name))
                return 0
        stack.enter_context(output_lock(output))

        def process(source, acquire):
            key = identity_key(source)
            try:
                raw = cached_message(output, source, max_raw)
                if raw is not None:
                    report["cached"] += 1
                else:
                    raw = acquire()
                if len(raw) > max_raw:
                    raise ImportFailure("Message exceeds the raw-message byte limit.")
                record = import_message(output, source, raw, max_pdf)
                report["messageIds"].append(record["id"])
                report["processed"] += 1
                for issue in record["issues"]:
                    report["failures"].append(f"Message {key[:12]}: {issue}")
                print(f"Message {key[:12]}: {len(record['attachments'])} PDF(s), {len(record['issues'])} issue(s).", flush=True)
            except (ImportFailure, ValueError, RecursionError) as error:
                if isinstance(error, ProtocolFailure):
                    raise
                detail = str(error) if isinstance(error, ImportFailure) else "Malformed email or saved record."
                report["failures"].append(f"Message {key[:12]}: {detail}")
                print(f"Message {key[:12]}: {detail}", flush=True)
            write_report(output, report)

        if args.demo or args.eml:
            for item in demo_messages() if args.demo else args.eml:
                if isinstance(item, Path):
                    with item.open("rb") as stream:
                        raw = stream.read(max_raw + 1)
                else:
                    raw = item
                process({"transport": "eml", "sha256": digest(raw)}, lambda raw=raw: raw)
        else:
            command(client, "select", quoted(encode_mailbox(args.mailbox)), readonly=True)
            _, values = client.response("UIDVALIDITY")
            if not values or not values[0] or not values[0].isdigit():
                raise ImportFailure("Server did not supply UIDVALIDITY; cannot identify source messages safely.")
            validity = values[0].decode()
            criteria = ["ALL"]
            if args.since:
                criteria.extend(["SINCE", imap_date(args.since)])
            if args.before:
                criteria.extend(["BEFORE", imap_date(args.before)])
            rows = command(client, "uid", "SEARCH", None, *criteria)
            uids = sorted({int(uid) for row in rows if isinstance(row, bytes) for uid in row.split()}, reverse=True)
            if any(uid <= 0 or uid > 4294967295 for uid in uids):
                raise ImportFailure("Server returned an invalid message UID.")
            print(f"{len(uids)} matching messages; checking the newest {min(len(uids), args.max_messages)}. Mailbox is read-only.", flush=True)
            for uid in uids[:args.max_messages]:
                source = {"transport": "imap", "host": args.host.lower(), "port": args.port,
                          "user": args.user, "mailbox": "INBOX" if args.mailbox.upper() == "INBOX" else args.mailbox,
                          "uidValidity": validity, "uid": str(uid)}
                process(source, lambda uid=uid: download_message(client, str(uid), max_raw))
        write_report(output, report)
    print(f"Report: {(output / 'report.html').as_uri()}")
    print(f"Manifest: {output / 'manifest.json'}")
    return 2 if report["failures"] else 0


def main(argv=None):
    os.umask(0o077)
    try:
        return run(options(argv))
    except ImportFailure as error:
        print(f"Import stopped: {error}", file=sys.stderr)
    except ssl.SSLCertVerificationError:
        print("TLS certificate verification failed. Check the hostname or supply a trusted --ca-file.", file=sys.stderr)
    except imaplib.IMAP4.error:
        print("IMAP connection or authentication failed. Check account settings, app password or OAuth access. Server text was omitted to protect credentials.", file=sys.stderr)
    except (OSError, ValueError):
        print("Import stopped: connection, TLS, local file, or response error. Check hostname, network, output permissions and available disk space; then retry.", file=sys.stderr)
    except (KeyboardInterrupt, EOFError):
        print("Import interrupted. Completed messages are retained; rerun to resume.", file=sys.stderr)
        return 130
    return 1


def selected_mailbox(client, args):
    command(client, "select", quoted(encode_mailbox(args.mailbox)), readonly=True)
    _, values = client.response("UIDVALIDITY")
    if not values or not values[0] or not values[0].isdigit():
        raise ImportFailure("Server did not supply UIDVALIDITY.")
    return {"transport": "imap", "host": args.host.lower(), "port": args.port,
            "user": args.user, "mailbox": "INBOX" if args.mailbox.upper() == "INBOX" else args.mailbox,
            "uidValidity": values[0].decode()}


def stage_attachments(output, records):
    attachments = []
    for record in records:
        for attachment in record["attachments"]:
            name = re.sub(r"[^\w .()-]", "_", attachment["filename"])[:100].strip(" .") or "attachment.pdf"
            if not name.lower().endswith(".pdf"):
                name += ".pdf"
            target = output / "staged" / attachment["occurrenceId"] / name
            atomic_write(target, (output / attachment["path"]).read_bytes())
            attachments.append({
                "id": attachment["occurrenceId"], "path": str(target), "name": name,
                "bytes": attachment["bytes"], "subject": record["headers"]["Subject"],
                "sender": record["headers"]["From"], "source": record["source"],
                "part": attachment["part"], "observedAt": record["observedAt"],
            })
    return attachments


def mailbox_page(output, args, request):
    """Snapshot matching mail, index received dates in bounded pages, then read one message.

    Cursors are supplied by the client only after it has attempted every attachment.
    Replaying a page reuses source identity and the original observation timestamp.
    """
    with output_lock(output):
        client = connect(args)
        try:
            source = selected_mailbox(client, args)
            operation = request["operation"]
            if operation == "start":
                criteria = ["ALL"]
                if args.since:
                    criteria += ["SINCE", imap_date(args.since)]
                if args.before:
                    criteria += ["BEFORE", imap_date(args.before)]
                rows = command(client, "uid", "SEARCH", None, *criteria)
                uids = sorted({int(uid) for row in rows if isinstance(row, bytes) for uid in row.split()})
                if any(uid <= 0 or uid > 4294967295 for uid in uids):
                    raise ImportFailure("Server returned an invalid message UID.")
                snapshot = {"source": source, "uids": uids, "indexed": 0, "dates": [], "issues": []}
                snapshot_id = os.urandom(16).hex()
            else:
                snapshot_id = request.get("snapshotId", "")
                if not re.fullmatch(r"[0-9a-f]{32}", snapshot_id):
                    raise ImportFailure("Invalid mailbox import snapshot.")
                snapshot = json.loads((output / "jobs" / (snapshot_id + ".json")).read_text())
                if snapshot["source"] != source:
                    raise ImportFailure("The mailbox identity changed. Start a new mailbox import.")
            path = output / "jobs" / (snapshot_id + ".json")
            result = {"snapshotId": snapshot_id, "total": len(snapshot["uids"]),
                      "mailboxes": [], "attachments": [], "issues": [], "cursor": request.get("cursor") or 0}
            if operation == "start" or snapshot["indexed"] < len(snapshot["uids"]):
                # Fetch only small headers, never message bodies, while determining chronology.
                previous_issues = len(snapshot["issues"])
                page = snapshot["uids"][snapshot["indexed"]:snapshot["indexed"] + 200]
                if page:
                    rows = command(client, "uid", "FETCH", ",".join(map(str, page)), "(UID INTERNALDATE)")
                    dates = {}
                    for row in rows:
                        if not isinstance(row, bytes):
                            raise ProtocolFailure("Unexpected mailbox date response.")
                        uid = re.search(rb"\bUID (\d+)\b", row)
                        received = re.search(rb'INTERNALDATE "([^"\r\n]+)"', row)
                        if uid and received and int(uid[1]) in page:
                            # Parse numeric offset explicitly; sender Date headers are untrusted ordering.
                            value = email.utils.parsedate_to_datetime(received[1].decode().replace("-", " ", 2))
                            if value is None or value.tzinfo is None:
                                raise ImportFailure("Server returned an invalid received date.")
                            dates[int(uid[1])] = value.timestamp()
                    for uid in page:
                        if uid in dates:
                            snapshot["dates"].append([dates[uid], uid])
                        else:
                            snapshot["issues"].append(f"Message UID {uid} disappeared or has no received date; it could not be imported.")
                    snapshot["indexed"] += len(page)
                if snapshot["indexed"] == len(snapshot["uids"]):
                    snapshot["dates"].sort()
                write_json(path, snapshot)
                result.update(phase="indexing", indexed=snapshot["indexed"], issues=snapshot["issues"][previous_issues:])
                return result
            cursor = request.get("cursor") or 0
            if not isinstance(cursor, int) or not 0 <= cursor <= len(snapshot["dates"]):
                raise ImportFailure("Invalid mailbox import position.")
            result.update(phase="importing", total=len(snapshot["dates"]), done=cursor == len(snapshot["dates"]))
            if result["done"]:
                return result
            uid = snapshot["dates"][cursor][1]
            message_source = {**source, "uid": str(uid)}
            try:
                raw = cached_message(output, message_source, args.max_message_mib * MIB)
                if raw is None:
                    raw = download_message(client, str(uid), args.max_message_mib * MIB)
                record = import_message(output, message_source, raw, args.max_pdf_mib * MIB)
                result["attachments"] = stage_attachments(output, [record])
                result["issues"] = [f"Message UID {uid}: {issue}" for issue in record["issues"]]
            except ImportFailure as error:
                if isinstance(error, ProtocolFailure):
                    raise
                result["issues"] = [f"Message UID {uid}: {error}"]
            result.update(cursor=cursor + 1, done=cursor + 1 == len(snapshot["dates"]))
            return result
        finally:
            client.shutdown()


def tauri_bridge(output: Path, request: dict) -> dict:
    """Fixed operations used by the desktop shell; no caller-selected paths or code."""
    operation = request.get("operation")
    if operation not in ("scan", "list", "demo", "start", "batch"):
        raise ImportFailure("Unknown email operation.")
    argv = ["--output", str(output), "--max-messages", str(request.get("maxMessages", 20))]
    if not 1 <= int(request.get("maxMessages", 20)) <= 100:
        raise ImportFailure("Choose between 1 and 100 messages.")
    if operation == "demo":
        argv.append("--demo")
    else:
        argv += ["--host", request.get("host", ""), "--user", request.get("user", ""),
                 "--port", str(request.get("port", 993)), "--mailbox", request.get("mailbox", "INBOX")]
        for field in ("since", "before"):
            if request.get(field):
                argv += ["--" + field, request[field]]
    args = options(argv)
    args.password = request.get("password", "")
    if operation in ("start", "batch"):
        return mailbox_page(output, args, request)
    if operation == "list":
        client = connect(args)
        try:
            return {"mailboxes": list_mailboxes(client), "attachments": [], "issues": []}
        finally:
            client.shutdown()
    # CLI progress is not part of the IPC result. The shell reads exactly one JSON value.
    with contextlib.redirect_stdout(io.StringIO()):
        run(args)
    manifest = json.loads((output / "manifest.json").read_text())
    records = {record["id"]: record for record in manifest["messages"]}
    return {"mailboxes": [], "attachments": stage_attachments(output, [records[key] for key in manifest["lastRun"]["messageIds"]]),
            "issues": manifest["lastRun"]["failures"]}



if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--tauri":
        os.umask(0o077)
        try:
            payload = sys.stdin.buffer.read(65537)
            if len(payload) > 65536:
                raise ImportFailure("Email request is too large.")
            result = tauri_bridge(Path(sys.argv[2]), json.loads(payload))
            print(json.dumps({"ok": True, "result": result}))
        except ImportFailure as error:
            print(json.dumps({"ok": False, "error": str(error)}))
        except ssl.SSLCertVerificationError:
            print(json.dumps({"ok": False, "error": "Mailbox TLS certificate verification failed. Check the IMAP hostname and its certificate."}))
        except (TimeoutError, ConnectionError, imaplib.IMAP4.abort):
            print(json.dumps({"ok": False, "error": "IMAP_RETRYABLE: The mailbox connection was interrupted or timed out. Retrying keeps the current position."}))
        except imaplib.IMAP4.error:
            print(json.dumps({"ok": False, "error": "The mailbox rejected an IMAP command. Check the login, app password and folder access. Server text is omitted to protect credentials."}))
        except OSError as error:
            print(json.dumps({"ok": False, "error": f"Email cache or connection could not be accessed (OS error {error.errno}). Check disk space, permissions and network access."}))
        except BaseException as error:
            print(json.dumps({"ok": False, "error": f"Email import could not process the mailbox response ({type(error).__name__}). Retry this operation; report this error type if it repeats."}))
    else:
        sys.exit(main())
