# Test the IMAP PDF connector prototype

Status: authoritative

Use this prototype to retrieve PDF attachments and inspect which email supplied
each file. The desktop Settings screen can import selected PDFs into the ordinary
Intent and document-processing flow. The standalone CLI remains available for
testing acquisition without the avenOS stack.

## Use the Tauri client

Start the worktree's client against the [local stack](local-stack.md#start-the-rust-client),
then open **Settings → Email**. Python 3.11 or newer must be available as `python3`
on the desktop's PATH. The native command embeds the connector source in the client
binary and invokes it directly; no script installation or terminal interaction is
needed. This prototype supports Linux and macOS, not mobile or the macOS App Store
sandbox. It does not bundle Python.

1. Enter the IMAP hostname, port, login, and password or app password.
2. Choose **Connect and list folders**, then select a folder. Leave the received-date
   fields empty to import the entire folder, or set an inclusive start and exclusive end.
3. Choose **This device** or **Server** processing, then **Import whole folder · oldest first**.
   The job snapshots every matching message present at the start and indexes the server's
   `INTERNALDATE`, ascending, with UID as a tie-breaker. Sender Date headers do not affect
   order. Each PDF gets a separate Intent, ordinary file upload, and document ingestion.
4. Leave Settings and keep using the app. Return to **Settings → Email** for progress,
   **Pause import**, **Resume import**, **Stop import**, and individual upload errors.
   **Retry failed PDFs** retries only failed uploads with their original publication IDs.
   **Open workspace** shows Intents and document-processing results.

The job processes one PDF pipeline at a time. Keep the desktop app open: the job survives
navigation but not an app restart or frontend reload. Closing the app stops acquisition;
restart the import with credentials to scan again and replay committed publications.
There is no unattended service or automatic restart recovery. Messages arriving after
snapshot creation belong to a later import. Each folder is a separate import; this does
not recursively import all folders in an account.

For a smaller preview, set **Preview message limit** (1–100, default 20), then choose
**Find PDF attachments**, select PDFs, and **Import selected PDFs**. That limit applies
only to the preview, which finds the highest matching UIDs; it does not cap the
whole-folder import. **Try sample emails** finds two synthetic emails containing
identical PDF bytes without making a mailbox connection. Importing the samples uploads
them to the signed-in workspace and starts ordinary document processing.

The form clears its password when starting an import, after a preview scan, and when
leaving the Email section. An active or paused mailbox job retains a separate credential
copy only in application memory until completion or **Stop import**. The native command
sends it over the child process's stdin, never command arguments or a file. Password
authentication is supported in the desktop form; the standalone CLI also accepts an
existing XOAUTH2 access token. Python runs in isolated mode. Each native operation stops
after five minutes; **Resume import** retries the current operation. Date indexing uses
200-message pages; acquisition reads one message per operation. Only one native scan
runs at a time. Interrupted connections retry the current operation three times with
increasing delays,
then pause the job. Authentication, mailbox-access, and other failures show a specific
error and pause immediately. Message extraction or upload failures are listed and remaining messages continue. Source-read failures require another
mailbox import; **Retry failed PDFs** applies to PDFs that reached the upload step.

Cache directories live under the app's OS cache directory in `imap-prototype/`,
partitioned by a hash of the authenticated Aven user ID and API origin. The current
customer route must still resolve to exactly one ready customer environment, as with
ordinary document upload. The job binds to the signed-in account before its first
connection, including retries. The native bridge discards results if the session changes,
and Intent creation and PDF upload reject imports bound to a different account.
Source emails and extracted PDFs remain locally after sign-out; there is no cache
cleanup control in this prototype.

Each attachment and processing placement has stable UUID-v5 Intent/publication IDs,
accepted by the Artifact Store’s declaration schema. Early prototype UUID-v8 declarations
were rejected; retrying those PDFs creates valid IDs. The earlier failed Intents are
retained in the workspace. Repeating the import with the same account, source, and placement replays the existing publication;
changing placement creates a separate import. The first observation timestamp is
retained with the cached message and normalized to UTC with a `Z` suffix before upload.
This also repairs cached timestamps that the artifact API rejected with
`ARTIFACT_REQUEST_INVALID` (HTTP 400). Removing that cache loses the timestamp, so this
prototype does not promise publication replay after manually deleting its cache.

Email source identity and bounded sender/subject context are recorded in the Intent's
source label and routing summary. Raw emails and complete attachment manifests remain
local; this is not yet an immutable email artifact/attachment-reference model in Artifact
Store. Imported PDFs are ordinary `client-actor-ingest` file sources. Document processing
uses the normal configured model route; selecting Device execution does not imply that
PDF bytes or model inputs stay exclusively on the device.

The desktop-specific checks are:

```sh
bun test app/tests/email-import.test.ts app/tests/email-job.test.ts app/tests/email-upload-boundary.test.ts
bun run check
bun run --cwd app build
cargo test --locked --manifest-path app/src-tauri/Cargo.toml --lib imap::tests
```

The Rust test invokes the embedded Python bridge with synthetic mail. The TypeScript
tests check stable publication identity and separation by account, source occurrence,
and execution placement. The HTTP-boundary regression feeds the connector’s
samples through the real artifact request validator for both placements, with storage
substituted. Job tests check 150-message pagination, ordered uploads, pause/resume,
failed-file retry, cancellation, and account changes. The [complete platform gate](build-and-test.md#complete-pre-deployment-gate)
still applies before releasing the client.

For the browser interaction check, start a separate worktree Vite server, then run
the test in another terminal:

```sh
(cd app && bun x vite --host 127.0.0.1 --port 1437 --strictPort)
```

```sh
node app/tests/email-ui.mjs
```

The browser check needs the repository's Playwright Chromium installation. It uses
the real Email settings component and synthetic connector results, simulates native
IPC receipts, and checks selection, password clearing, account binding, and admission
into document processing. It also checks continuation after leaving the Email pane and
that background uploads leave the selected conversation unchanged. It makes no real
mailbox or customer-service requests.
`AVEN_EMAIL_UI_URL` overrides the Vite origin; the default is `http://127.0.0.1:1437`.

The real-store regression starts disposable PostgreSQL and Rust Artifact Store containers,
publishes both Python samples with Device and Server placement through the actual API
handler and coordinator, verifies publication replay and exact PDF readback, and removes
the containers. It also reproduces the old UUID-v8 schema rejection. It requires Docker
and its PostgreSQL image; run from the repository root:

```sh
docker build --file services/artifact-store/Dockerfile --tag aven-imap-store-test:local .
bun app/tests/email-store-integration.ts
```

`AVEN_EMAIL_TEST_STORE_IMAGE` selects an already-built store image instead. The proof uses
only synthetic credentials and PDFs; it does not access the signed-in customer's database.
The browser test separately checks admission into document processing.

## Requirements and first run

For the standalone CLI, use Linux or macOS with Python 3.11 or newer. No Python packages, Bun dependencies,
database, or Docker stack are required. Run these commands from the worktree root.

Try synthetic mail first; this makes no network connection:

```sh
python3 prototypes/imap-pdf/imap_pdf.py --demo --output prototypes/imap-pdf/demo-output
```

Open the printed `report.html` URL in a browser. The report should show two emails
with the same sample PDF. Both source occurrences remain in `manifest.json`, while
the `pdfs` directory contains one file. Repeating the command should reuse both
saved messages and preserve the same occurrence identifiers.

To connect to your mailbox:

```sh
python3 prototypes/imap-pdf/imap_pdf.py
```

Enter the IMAP hostname, mailbox login, and password at the prompts. Password entry
is hidden and the tool does not save it. The default selects `INBOX` and processes
the 50 highest matching UIDs. These are normally the most recently added messages;
they are not sorted by the sender's Date header.

Use your provider's IMAP hostname and permitted authentication method. If the
provider requires an app password, use that password. Providers that disable password
login require OAuth; this prototype can consume an existing access token but does
not implement OAuth consent or token refresh.

For a chosen folder and received-date window, use:

```sh
python3 prototypes/imap-pdf/imap_pdf.py --host imap.example.com --user you@example.com --mailbox INBOX --since 2026-09-01 --before 2026-09-15 --max-messages 100
```

Replace the example host and login. `--since` is inclusive and `--before` exclusive;
IMAP applies them to its internal received date. The example does not contact a
verified provider. The tool searches all matching messages, including read mail;
it does not rely on provider-specific attachment-search extensions.

List selectable mailboxes before choosing a folder:

```sh
python3 prototypes/imap-pdf/imap_pdf.py --host imap.example.com --user you@example.com --list-mailboxes
```

Pass the displayed folder name exactly, quoted if it contains spaces. International
folder names use IMAP modified UTF-7. TLS is mandatory, with certificate and hostname
verification; port 993 is the default. `--port` selects another implicit-TLS port.
`--ca-file` accepts a trusted PEM bundle for a private server. Plaintext IMAP and
STARTTLS are not implemented.

## Credentials and retained data

For automation, `IMAP_PASSWORD` supplies the password instead of prompting. An
existing OAuth bearer token can instead be supplied through `IMAP_ACCESS_TOKEN`,
using SASL XOAUTH2. Set only one. Keep these values in your process environment;
there is no password argument, credential file, or saved refresh token. Never put
them in Git, report files, or command arguments. The tool does not print server
error text, which may echo authentication details. An expired OAuth token requires
obtaining a new token outside this prototype.

The default output is `prototypes/imap-pdf/output/`, ignored by Git. `--output`
selects another directory. Each directory belongs to one tester and may contain
multiple mailbox imports; the report displays all retained imports in it. Source
emails include their complete bodies and attachments, even when only PDFs are
extracted. The local output contains private mailbox data and is not encrypted.
New files use owner-only permissions; the output directory is restricted to its
owner. An advisory lock prevents simultaneous imports into the same output.

| Output | Contents |
| --- | --- |
| `report.html` | Local report with source-email and PDF links; no email HTML or remote resources are rendered |
| `manifest.json` | All retained message records and the latest run summary |
| `records/` | One atomic JSON receipt per source message, including attachment occurrences and extraction issues |
| `jobs/` | Desktop mailbox snapshots with received-date ordering; no credentials |
| `staged/` | Desktop PDFs with sanitized original filenames for ordinary upload |
| `messages/` | Raw `.eml` snapshots, named by source identity |
| `pdfs/` | Extracted PDFs, named by SHA-256 rather than untrusted attachment filenames |

PDF detection uses declared MIME type, a `.pdf` filename, or an octet-stream body
containing `%PDF-` in its first 1,024 bytes. Inline PDFs and PDFs inside attached
emails are included. The signature check is not PDF validation or malware scanning.
Malformed transfer encoding is reported rather than silently imported. ZIP archives,
encrypted email contents, and remote download links are not unpacked or followed.

## Bounds and retry behavior

Each raw message is limited to 32 MiB and each decoded PDF to 20 MiB by default.
MIME encoding makes a raw message larger than its attachments. Override these
using `--max-message-mib` and `--max-pdf-mib`; each must be between 1 and 128.
IMAP downloads use 256 KiB partial fetches, with literal and response limits before
allocation. MIME parsing buffers one admitted message in memory and may use several
times its raw size. Extraction limits traversal to 1,000 parts and 30 nested levels;
the Python parser itself runs before these traversal limits.

The connection has a 30-second socket timeout. The tool uses `EXAMINE`, UID reads,
and `BODY.PEEK[]`; it never sends flag changes, mailbox moves, deletions, or EXPUNGE.
Message-level size or extraction failures are reported and other messages continue.
Protocol corruption, TLS/authentication errors, connection loss, and local filesystem
errors stop the invocation. Exit status is 0 for a completed run without issues,
2 for a completed run with message issues, 1 for a stopped run, and 130 for interruption.

Rerun the same command after a failure. Completed records and their raw-message
hashes are checked before reusing saved bytes; damaged or missing snapshots are
downloaded again. Extraction reruns from saved bytes and repairs missing PDF files.
Files and records publish through atomic replacements. A crash can leave unreferenced
files, but no successful receipt is written before its PDFs exist. The CLI
does not provide power-loss recovery guarantees or background resumption.

Each standalone CLI invocation selects the newest matching UIDs again; there is no advancing sync
cursor. Repeating a capped import does not page further into older mail. Increase
the cap or use a different received-date window for older messages. A changed
UIDVALIDITY creates new source occurrences. Copying mail to a different folder
also creates distinct occurrences. Identical PDF bytes still share one local file.
Source mailbox deletion does not remove local imports. There is no automatic retention
or cleanup policy. Deleting the output directory deletes all its saved mail and PDFs.

## Offline files and verification

Saved `.eml` files exercise the same extraction path without credentials:

```sh
python3 prototypes/imap-pdf/imap_pdf.py --eml /absolute/path/message.eml
```

Repeat `--eml` for several files. Offline source identity is the raw-message hash;
two identical `.eml` files represent one offline occurrence. IMAP source identity
instead uses the account, mailbox, UIDVALIDITY, and UID.

Run automated checks with Python and OpenSSL installed:

```sh
python3 -m unittest discover -s prototypes/imap-pdf -p 'test_*.py' -v
bun run check:docs
git diff --check
bun run test:deploy
```

The focused suite generates a temporary TLS certificate and uses a loopback IMAP
server. It tests real TLS, read-only commands, partial fetches, date filters, mailbox
names, OAuth transport, credential-error redaction, repeated imports, UIDVALIDITY
changes, corrupt cache repair, truncation, and connection loss. MIME tests cover
nested/inline PDFs, filenames, malformed encoding, size bounds, and report escaping.
This fixture does not establish compatibility with a particular provider.

For your live test, note an unread message with a PDF, run a small import, then
confirm it is still unread. Open the saved PDF, compare its source-email link, and
rerun to check stable records. Share failure counts and the generic error message
when reporting a problem; keep credentials and private email contents out of reports.
