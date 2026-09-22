# Mail observations

This package describes a bounded mailbox search and subsequent selected-message read.
It keeps account, mailbox, UIDVALIDITY and UID together so an old selection cannot
silently identify a different message after a mailbox rebuild.

Queries contain typed criteria, requested metadata and command/time/result budgets.
Results distinguish complete, truncated and incomplete coverage. Continuation
references identify prior committed results; the host resolves them under current
authority. Request JSON cannot invent its own continuation fence or contain credentials.

The optional protected Actors now publish byte-exact raw mail through the common
Artifact Store. The ordinary message-parts Actor consumes that saved occurrence,
not a live mailbox. Its short-lived native parser uses pinned `mail-parser` 0.11.9
and returns source byte ranges, decoding outcomes and files. The first profile admits
plain text, JSON, CSV, PDF, PNG and JPEG. Declared MIME types are not file validation.
HTML, encrypted content, nested messages and unsupported encodings remain in the
original and appear as unsupported parts; they are not silently omitted as successes.

Parsing is bounded to 4 MiB raw input, 8 MiB decoded content, 128 parts, 16 nesting
levels and 32 KiB headers per part. The host gives it no environment or credentials,
caps output and kills it after five seconds; Unix CPU time is capped at three seconds
and Linux address space at 512 MiB. No parser code opens a network connection.
The parent validates lengths, digests and ranges before shared publication. Equal-byte
attachments remain distinct occurrences with separate evidence edges.

These checks do not qualify the full customer deployment or native settings journey. See
[IMAP Actors and provenance](../../docs/imap-mailbox-actors.md) and
[test procedures](../../docs/operations/build-and-test.md).
