# IMAP PDF connector prototype

Download PDF attachments from a mailbox and inspect them alongside their email
provenance. This standalone Python prototype uses the standard library and writes
local files. The Tauri client's Settings → Email screen embeds this connector through
a native command and sends selected PDFs or a whole folder through the app's existing
document flow. Whole-folder jobs snapshot received-date order and acquire mail in pages;
the client module owns the upload queue independently of the settings component.
Committed PDFs enter a separate document-processing queue, so ingestion does not
block acquisition or publication.
The standalone CLI does not publish to Artifact Store or start document Actors.

The [testing guide](../../docs/operations/imap-pdf-prototype.md) owns setup,
commands, credentials, output, retry behavior, and current limitations.

`imap_pdf.py` separates read-only IMAP acquisition, MIME extraction, and file
publication. The source identity includes host, port, login, mailbox, UIDVALIDITY,
and UID. Each PDF occurrence adds its MIME tree path; its bytes are stored by
SHA-256. A repeated import can therefore reuse bytes without losing the distinct
emails that supplied them. MIME paths are local extraction paths, not IMAP section
identifiers.

The Gmail importer in avenCEO-tools supplied the behavioral reference: inspect PDF
candidates, retain provenance, bound sizes, and continue after message-level
failures. This implementation uses IMAP and Python's email parser; it does not
depend on Gmail's parsed message payloads or its database.

`test_imap_pdf.py` includes a loopback TLS server that exercises the real IMAP
client, plus MIME and storage tests. It uses only synthetic messages.
