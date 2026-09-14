"""Offline MIME/storage tests and a real loopback TLS IMAP protocol fixture."""

import contextlib
import io
import json
import os
from pathlib import Path
import re
import socketserver
import ssl
import subprocess
import tempfile
import threading
import unittest
from email.message import EmailMessage
from unittest.mock import patch

import imap_pdf as app


def email_with(content=b"%PDF-1.4\nexample", filename="invoice.pdf", subtype="pdf", cte="base64"):
    message = EmailMessage()
    message["Subject"] = '<script>alert("email")</script>'
    message["From"] = "sender@example.test"
    message.set_content("Email body")
    message.add_alternative("<img src='https://example.test/tracker'>", subtype="html")
    message.add_attachment(content, maintype="application", subtype=subtype, filename=filename, cte=cte)
    return message.as_bytes()


class ExtractionTests(unittest.TestCase):
    def test_inline_quoted_printable_and_nested_forwarded_email(self):
        inner = EmailMessage()
        inner.set_content(b"%PDF-1.4\ninline", maintype="application", subtype="pdf", cte="quoted-printable")
        inner["Content-Disposition"] = 'inline; filename="rechnung.pdf"'
        outer = EmailMessage()
        outer.set_content("Forwarded receipt")
        outer.add_attachment(inner)
        _, attachments, issues = app.extract_pdfs(outer.as_bytes(), 1024)
        self.assertEqual(issues, [])
        self.assertEqual(len(attachments), 1)
        self.assertEqual(attachments[0]["content"], b"%PDF-1.4\ninline")
        self.assertEqual(attachments[0]["disposition"], "inline")

    def test_filename_is_metadata_and_octet_stream_is_inspected(self):
        raw = email_with(filename="../../misleading.bin", subtype="octet-stream")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            record = app.import_message(root, {"uid": "3"}, raw, 1024)
            self.assertEqual(record["attachments"][0]["filename"], "../../misleading.bin")
            self.assertRegex(record["attachments"][0]["path"], r"^pdfs/[a-f0-9]{64}\.pdf$")
            self.assertEqual(len(list((root / "pdfs").iterdir())), 1)

    def test_rejects_false_pdf_oversize_and_bad_base64(self):
        for raw, limit, text in [
            (email_with(b"not PDF"), 1024, "no PDF signature"),
            (email_with(b"%PDF-" + b"x" * 100), 20, "byte limit"),
            (b"Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQ=!!!", 1024, "decode"),
        ]:
            with self.subTest(text=text):
                _, attachments, issues = app.extract_pdfs(raw, limit)
                self.assertFalse(attachments)
                self.assertIn(text, " ".join(issues))

    def test_missing_filename_and_encoded_filename(self):
        raw = b"Content-Type: application/pdf\r\n\r\n%PDF-1.4\r\n"
        _, attachments, _ = app.extract_pdfs(raw, 1024)
        self.assertEqual(attachments[0]["filename"], "attachment-1.pdf")
        _, attachments, _ = app.extract_pdfs(email_with(filename="Rechnung März.pdf"), 1024)
        self.assertEqual(attachments[0]["filename"], "Rechnung März.pdf")

    def test_malformed_multipart_is_visible(self):
        _, _, issues = app.extract_pdfs(b"Content-Type: multipart/mixed; boundary=missing\r\n\r\nbody", 1024)
        self.assertTrue(issues)

    def test_duplicate_occurrences_and_report_escaping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = email_with()
            first = app.import_message(root, {"uid": "1"}, raw, 1024)
            second = app.import_message(root, {"uid": "2"}, raw, 1024)
            self.assertNotEqual(first["attachments"][0]["occurrenceId"], second["attachments"][0]["occurrenceId"])
            self.assertEqual(len(list((root / "pdfs").glob("*.pdf"))), 1)
            app.import_message(root, {"uid": "1"}, raw, 1024)
            self.assertEqual(len(list((root / "records").glob("*.json"))), 2)
            app.write_report(root, {"processed": 2, "cached": 0, "failures": []})
            page = (root / "report.html").read_text()
            self.assertNotIn("<script>", page)
            self.assertIn("&lt;script&gt;", page)
            self.assertNotIn("https://example.test/tracker", page)

    def test_mailbox_encoding(self):
        for value in ['INBOX', 'Sent Items', 'Kunden & März/日本語', 'Quotes " and \\']:
            self.assertEqual(app.decode_mailbox(app.encode_mailbox(value).encode()), value)
        with self.assertRaises(app.ImportFailure):
            app.quoted("INBOX\r\nEXPUNGE")

    def test_output_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with app.output_lock(root):
                with self.assertRaises(app.ImportFailure):
                    with app.output_lock(root):
                        pass

    def test_literal_bound_before_allocation(self):
        client = object.__new__(app.BoundedIMAP)
        with self.assertRaises(app.ProtocolFailure):
            client.read(app.CHUNK + 1)

    def test_desktop_bridge_limits_results_and_preserves_retry_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = app.tauri_bridge(root, {"operation": "demo"})
            second = app.tauri_bridge(root, {"operation": "demo"})
            self.assertEqual(first, second)
            self.assertEqual(len(first["attachments"]), 2)
            for attachment in first["attachments"]:
                self.assertTrue(Path(attachment["path"]).is_file())
                self.assertTrue(attachment["path"].endswith("sample-invoice.pdf"))
                self.assertIn("observedAt", attachment)
            with self.assertRaises(app.ImportFailure):
                app.tauri_bridge(root, {"operation": "shell"})


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b"* OK local test server\r\n")
        while line := self.rfile.readline():
            tag, action, *rest = line.rstrip(b"\r\n").split(b" ", 2)
            arg = rest[0] if rest else b""
            action = action.upper()
            # The fixture records command kinds, never passwords or bearer tokens.
            self.server.commands.append((action, arg if action not in (b"LOGIN", b"AUTHENTICATE") else b"[redacted]"))
            if action == b"CAPABILITY":
                self.wfile.write(b"* CAPABILITY IMAP4rev1 AUTH=XOAUTH2\r\n")
            elif action == b"LOGIN" and self.server.deny:
                self.wfile.write(tag + b" NO secret-echo-do-not-print\r\n")
                continue
            elif action == b"AUTHENTICATE":
                self.wfile.write(b"+ \r\n")
                self.rfile.readline()
            elif action == b"LIST":
                self.wfile.write(b'* LIST (\\HasNoChildren) "/" "INBOX"\r\n')
                self.wfile.write(b'* LIST (\\HasNoChildren) "/" "Kunden &- M&AOQ-rz"\r\n')
                self.wfile.write(b'* LIST (\\Noselect) "/" "Parent"\r\n')
            elif action == b"EXAMINE":
                self.wfile.write(b"* 2 EXISTS\r\n* OK [UIDVALIDITY " + self.server.validity + b"] stable\r\n")
            elif action == b"UID" and arg.startswith(b"SEARCH"):
                self.wfile.write(b"* SEARCH " + b" ".join(str(uid).encode() for uid in self.server.uids) + b"\r\n")
            elif action == b"UID" and arg.startswith(b"FETCH"):
                uid = arg.split()[1]
                raw = self.server.raw
                if b"INTERNALDATE" in arg:
                    for value in uid.split(b","):
                        day = b"01" if value == b"42" else b"02"
                        self.wfile.write(b'* 1 FETCH (UID ' + value + b' INTERNALDATE "' + day + b'-Jan-2026 12:00:00 +0200")\r\n')
                elif b"RFC822.SIZE" in arg:
                    self.wfile.write(b"* 1 FETCH (UID " + uid + b" RFC822.SIZE " + str(len(raw)).encode() + b")\r\n")
                else:
                    match = re.search(rb"BODY.PEEK\[\]<(\d+)\.(\d+)>", arg)
                    if not match:
                        raise AssertionError("Expected read-only partial fetch")
                    offset, size = map(int, match.groups())
                    chunk = raw[offset:offset + size]
                    if self.server.truncate:
                        chunk = chunk[:-1]
                    if self.server.disconnect:
                        return
                    prefix = b"* 1 FETCH (" if self.server.uid_after else b"* 1 FETCH (UID " + uid + b" "
                    suffix = b" UID " + uid if self.server.uid_after else b""
                    self.wfile.write(prefix + b"BODY[]<" + str(offset).encode() + b"> {" + str(len(chunk)).encode() + b"}\r\n" + chunk + suffix + b")\r\n")
            elif action not in (b"LOGIN", b"LOGOUT"):
                raise AssertionError(f"Unexpected command {action!r}")
            self.wfile.write(tag + b" OK done\r\n")


class TLSServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def get_request(self):
        sock, address = super().get_request()
        try:
            return self.context.wrap_socket(sock, server_side=True), address
        except BaseException:
            sock.close()
            raise


class ProtocolTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.cert = Path(cls.temp.name) / "cert.pem"
        key = Path(cls.temp.name) / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(cls.cert), "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.server = TLSServer(("127.0.0.1", 0), Handler)
        cls.server.context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.server.context.load_cert_chain(cls.cert, key)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def setUp(self):
        self.output = tempfile.TemporaryDirectory()
        self.addCleanup(self.output.cleanup)
        self.server.raw = email_with(b"%PDF-1.4\n" + b"X" * (app.CHUNK + 100))
        self.server.commands = []
        self.server.validity = b"100"
        self.server.deny = self.server.truncate = self.server.disconnect = False
        self.server.uid_after = False
        self.server.uids = [7, 42]
        self.args = ["--host", "localhost", "--port", str(self.server.server_address[1]),
                     "--user", "test@example.test", "--ca-file", str(self.cert),
                     "--output", self.output.name]

    def invoke(self, extra=(), args=None, token=False):
        out, err = io.StringIO(), io.StringIO()
        env = {"IMAP_PASSWORD": "" if token else "synthetic-test-password",
               "IMAP_ACCESS_TOKEN": "synthetic-access-token" if token else ""}
        with patch.dict(os.environ, env), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            result = app.main((args if args is not None else self.args) + list(extra))
        return result, out.getvalue(), err.getvalue()

    def test_real_tls_read_only_chunking_cache_and_uidvalidity(self):
        code, _, err = self.invoke(["--since", "2026-01-01", "--before", "2026-02-01"])
        self.assertEqual((code, err), (0, ""))
        commands = self.server.commands
        self.assertTrue(any(action == b"EXAMINE" for action, _ in commands))
        self.assertTrue(any(b"SINCE 01-Jan-2026 BEFORE 01-Feb-2026" in arg for _, arg in commands))
        body_commands = [arg for _, arg in commands if b"BODY.PEEK" in arg]
        self.assertGreaterEqual(len(body_commands), 4)
        self.assertFalse(any(action in (b"SELECT", b"STORE", b"EXPUNGE", b"CLOSE") for action, _ in commands))
        root = Path(self.output.name)
        self.assertEqual(len(list((root / "pdfs").glob("*.pdf"))), 1)
        self.assertEqual(len(list((root / "records").glob("*.json"))), 2)
        # A retry needs no body downloads and repairs a deleted derived PDF.
        next((root / "pdfs").glob("*.pdf")).unlink()
        self.server.commands = []
        code, out, _ = self.invoke()
        self.assertEqual(code, 0)
        self.assertFalse(any(b"FETCH" in arg for _, arg in self.server.commands))
        self.assertEqual(len(list((root / "pdfs").glob("*.pdf"))), 1)
        manifest = json.loads((root / "manifest.json").read_text())
        self.assertEqual(manifest["lastRun"]["cached"], 2)
        self.server.validity = b"101"
        self.assertEqual(self.invoke()[0], 0)
        self.assertEqual(len(list((root / "records").glob("*.json"))), 4)
        self.assertEqual(len(list((root / "pdfs").glob("*.pdf"))), 1)

    def test_whole_mailbox_pages_by_received_date_and_replays(self):
        args = app.options(self.args)
        args.password = "synthetic-test-password"
        root = Path(self.output.name)
        first = app.mailbox_page(root, args, {"operation": "start"})
        self.assertEqual(first["total"], 2)
        self.assertEqual(first["indexed"], 2)
        request = {"operation": "batch", "snapshotId": first["snapshotId"], "cursor": 0}
        oldest = app.mailbox_page(root, args, request)
        self.assertEqual(oldest["attachments"][0]["source"]["uid"], "42")
        self.assertFalse(oldest["done"])
        self.assertEqual(oldest, app.mailbox_page(root, args, request))
        request["cursor"] = oldest["cursor"]
        newest = app.mailbox_page(root, args, request)
        self.assertEqual(newest["attachments"][0]["source"]["uid"], "7")
        self.assertTrue(newest["done"])
        self.server.validity = b"101"
        with self.assertRaises(app.ImportFailure):
            app.mailbox_page(root, args, request)
        request["snapshotId"] = "../../escape"
        self.server.validity = b"100"
        with self.assertRaises(app.ImportFailure):
            app.mailbox_page(root, args, request)

    def test_date_index_advances_past_200_messages(self):
        self.server.uids = list(range(1, 206))
        args = app.options(self.args)
        args.password = "synthetic-test-password"
        root = Path(self.output.name)
        first = app.mailbox_page(root, args, {"operation": "start"})
        self.assertEqual((first["total"], first["indexed"]), (205, 200))
        request = {"operation": "batch", "snapshotId": first["snapshotId"], "cursor": 0}
        second = app.mailbox_page(root, args, request)
        self.assertEqual((second["phase"], second["indexed"]), ("indexing", 205))
        oldest = app.mailbox_page(root, args, request)
        self.assertEqual(oldest["attachments"][0]["source"]["uid"], "42")
        # An arrival after snapshot creation does not move the cursor or enter this job.
        self.server.uids.append(999)
        request["cursor"] = 204
        last = app.mailbox_page(root, args, request)
        self.assertTrue(last["done"])
        self.assertEqual(last["total"], 205)
        self.assertEqual(last["attachments"][0]["source"]["uid"], "205")

    def test_empty_mailbox_completes(self):
        self.server.uids = []
        args = app.options(self.args)
        args.password = "synthetic-test-password"
        root = Path(self.output.name)
        first = app.mailbox_page(root, args, {"operation": "start"})
        last = app.mailbox_page(root, args, {"operation": "batch", "snapshotId": first["snapshotId"], "cursor": 0})
        self.assertTrue(last["done"])
        self.assertEqual(last["total"], 0)
        self.assertEqual(last["attachments"], [])

    def test_list_mailboxes_and_oauth(self):
        code, out, err = self.invoke(["--list-mailboxes"], token=True)
        self.assertEqual((code, err), (0, ""))
        self.assertIn("Kunden & März", out)
        self.assertNotIn("Parent", out)
        self.assertFalse(any(action == b"EXAMINE" for action, _ in self.server.commands))

    def test_uid_can_follow_body_literal(self):
        self.server.uid_after = True
        self.assertEqual(self.invoke()[0], 0)

    def test_message_limit(self):
        self.assertEqual(self.invoke(["--max-messages", "1"])[0], 0)
        manifest = json.loads((Path(self.output.name) / "manifest.json").read_text())
        self.assertEqual(len(manifest["messages"]), 1)
        self.assertEqual(manifest["messages"][0]["source"]["uid"], "42")

    def test_corrupted_cache_is_refetched(self):
        self.assertEqual(self.invoke()[0], 0)
        next((Path(self.output.name) / "messages").glob("*.eml")).write_bytes(b"corrupt")
        self.server.commands = []
        self.assertEqual(self.invoke()[0], 0)
        self.assertTrue(any(b"BODY.PEEK" in arg for _, arg in self.server.commands))

    def test_truncation_stops_without_receipt_and_retries(self):
        self.server.truncate = True
        self.assertEqual(self.invoke()[0], 1)
        self.assertFalse(list(Path(self.output.name).glob("records/*.json")))
        self.server.truncate = False
        self.assertEqual(self.invoke()[0], 0)

    def test_disconnect_stops_without_receipt(self):
        self.server.disconnect = True
        self.assertEqual(self.invoke()[0], 1)
        self.assertFalse(list(Path(self.output.name).glob("records/*.json")))

    def test_oversized_message_is_not_downloaded(self):
        self.server.raw = b"X" * (app.MIB + 1)
        self.assertEqual(self.invoke(["--max-message-mib", "1"])[0], 2)
        self.assertFalse(any(b"BODY.PEEK" in arg for _, arg in self.server.commands))

    def test_authentication_errors_do_not_echo_secrets(self):
        self.server.deny = True
        code, out, err = self.invoke()
        self.assertEqual(code, 1)
        self.assertNotIn("secret-echo", out + err)
        self.assertNotIn("synthetic-test-password", out + err)
        self.assertIn("authentication failed", err)

    def test_untrusted_tls_is_rejected(self):
        args = self.args.copy()
        pos = args.index("--ca-file")
        del args[pos:pos + 2]
        code, _, err = self.invoke(args=args)
        self.assertEqual(code, 1)
        self.assertIn("certificate verification failed", err)


if __name__ == "__main__":
    unittest.main()
