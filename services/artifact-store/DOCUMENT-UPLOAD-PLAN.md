# Document Upload Vertical-Slice Plan

Status: spike implemented; manual desktop acceptance pending

Date: 23 August 2026

## Spike result

The vertical slice is implemented across the Artifact Store SDK, Aven API, Tauri
host, and inline intent conversation:

- `@avenos/artifact-store` accepts streaming request bodies without changing its
  existing byte-array API.
- Aven API exposes the authenticated, name-gated
  `PUT /api/artifacts/files/{publicationId}` coordinator and binds user and scope
  context server-side.
- The Tauri host validates, hashes, and streams one file while emitting correlated
  progress events. Its Aven API session and the Artifact Store service token remain
  outside webview state.
- The dashboard accepts native drops, opens the selected intent detail, and renders
  queued, preparing, uploading, finalizing, committed, and failed attachment states
  in its inline conversation.
- Only a committed `{originalName, artifactId}` record is added to future model
  context; dropping a file does not invoke the model.

Automated TypeScript and Rust checks pass. The rebuilt combined Compose stack also
passed an authenticated upload, publication, receipt, and byte-for-byte content
roundtrip. The temporary acceptance identity was removed afterward. A physical file
drop in a running desktop shell remains the final manual acceptance step.

## Goal

Allow a signed-in person to drag and drop a document or other regular file into the
open avenOS desktop window. The selected intent detail opens immediately and displays
a file card with upload progress in its conversation. After the Artifact Store commits
the file, the chat entry retains both the original filename and the authoritative
artifact ID so later conversation can refer to the exact artifact.

This is the first application-facing Artifact Store vertical slice. It deliberately
does not start document processing, OCR, classification, or an automatic model reply.

## Architecture

```text
File dropped into Tauri window
  -> Tauri validates, hashes, and streams the local file
  -> authenticated request to Aven API
  -> Aven API authorizes the user and coordinates publication
  -> Artifact Store stages the bytes and publishes core.file@1
  -> chat attachment becomes {originalName, artifactId}
```

The webview must not receive the Artifact Store service token or the Aven API bearer
session. The Tauri host already owns the native session and remains the only component
that sends that session credential. Aven API holds the Artifact Store service
credential and is the application authorization boundary. The native drop path crosses
the trusted Tauri event-to-command IPC only for the duration of the call; it is never
retained in UI state, chat history, model context, or a remote request.

The initial local topology uses the configured preview scope. Name-to-scope selection
and the final per-request Artifact Store authorization-decision adapter are follow-up
work; request data must not be allowed to override publisher or scope context in this
slice.

## Current constraints

- Native file dropping is disabled in `app/src-tauri/tauri.conf.json`.
- Aven API receives Artifact Store connection settings from the local Compose overlay,
  but it has no authenticated upload facade yet.
- `@avenos/artifact-store` accepts in-memory upload bytes and needs a streaming upload
  form for the Aven API forwarding path.
- The Artifact Store currently accepts request bodies up to 100 MiB and buffers one
  upload in its HTTP adapter. "Any file" therefore means any file format, not an
  unlimited file size.
- Chat turns currently contain text only. They need a structured attachment state
  without exposing a local path.
- The selected intent's inline conversation is the canonical answer surface and should
  be reused rather than adding a separate upload window.

## First-slice decisions

1. Support one regular file per drop. Reject directories and multi-file drops with a
   clear message.
2. Accept every file format up to 100 MiB.
3. Retain only the basename, byte length, declared media type, digest, publication ID,
   and artifact ID. Never place the full local path in UI or model state.
4. Infer a media type from the filename and fall back to
   `application/octet-stream`.
5. Publish exactly one `core.file@1` root occurrence with:
   - `originalName`: the validated basename;
   - `declaredMediaType`: the inferred or fallback media type; and
   - `sourceKind`: `desktop-drop`.
6. Generate the publication UUID in the Tauri host before network activity. A retry
   for the same chat attachment reuses the exact publication UUID and intent while
   obtaining a fresh upload claim.
7. Bind the root actor to the authenticated user in Aven API. The fixed preview
   Artifact Store publisher remains the Aven API service identity.
8. Do not call the language model automatically when a file is dropped.

## Upload lifecycle and UI state

Each attachment follows this state machine:

```text
queued -> preparing -> uploading -> finalizing -> committed
                              \-> failed
```

- `queued`: the drop was accepted and a chat entry exists.
- `preparing`: Tauri validates metadata and computes SHA-256 in a first file pass.
- `uploading`: Tauri streams the second file pass to Aven API. The card displays a
  monotonic integer percentage derived from bytes sent divided by total bytes.
- `finalizing`: all request bytes were sent and Aven API is staging and committing the
  root publication.
- `committed`: the card displays the original name and full authoritative artifact ID.
- `failed`: the card stays visible with a useful error and no artifact ID.

Dropping a file selects the intents workspace and expands the selected intent detail
immediately. A lightweight whole-window drop affordance indicates that the file can be
released, while the upload state itself belongs in the inline conversation.

## Implementation plan

### 1. Aven API Artifact Store facade

Add a narrow idempotent endpoint:

```text
PUT /api/artifacts/files/{publicationId}
```

The Tauri request supplies raw bytes plus validated metadata headers for original name,
media type, content length, and SHA-256. The route must:

1. authenticate the existing Better Auth bearer session;
2. require a verified user and confirm name ownership;
3. bind the configured Artifact Store scope and service credential server-side;
4. obtain the current store context and epoch;
5. generate a fresh claim UUID and forward the body to the exact upload route;
6. construct one immutable `core.file@1` root intent using the route publication UUID;
7. publish using the upload claim and store-epoch precondition;
8. verify the publication response; and
9. return a compact result containing publication ID, artifact ID, original name,
   media type, digest, length, scope sequence, and replay status.

The route must reject malformed names, separators or control characters, inconsistent
length/digest metadata, oversized files, unauthenticated sessions, and attempts to
supply publisher or scope identity.

Artifact Store configuration becomes typed Aven API configuration and is required only
when this facade is enabled. Upstream Artifact Store problem codes should map to stable,
safe Aven API errors without returning credentials or internal URLs.

### 2. Streaming SDK support

Extend `@avenos/artifact-store` with a streaming upload form while keeping the existing
`Uint8Array` API compatible. The streaming form must preserve the exact required
headers:

```text
Content-Type
Content-Length
X-Expected-SHA256
Authorization
```

Aven API should forward the incoming stream instead of buffering a second complete
copy. The Artifact Store remains authoritative for validating the digest and length.
Publication submission continues through the SDK canonicalizer.

### 3. Native Tauri upload command

Enable native drag-and-drop for the main webview and register one listener for the
Tauri drag/drop event lifecycle. Add a Rust command that receives only a correlation
ID, stable publication UUID, and native path from the trusted Tauri event.

The command must:

1. ensure the path resolves to a regular file;
2. extract and validate the basename;
3. reject files larger than 100 MiB before network activity;
4. infer the media type;
5. hash the file incrementally without loading it all into memory;
6. retrieve the native Aven API session token from `AuthState`;
7. stream the file to the hard-coded Aven API artifact endpoint; and
8. emit correlated progress events containing bytes sent and total bytes.

The webview chooses neither the remote base URL nor an authorization header. Progress
events include the correlation ID so stale or concurrent events cannot update the
wrong attachment.

### 4. Structured chat attachments

Extend the chat turn representation with optional attachment data rather than encoding
progress in mutable prose. The attachment contains:

```ts
interface ArtifactAttachment {
	readonly uploadId: string
	readonly publicationId: string
	readonly originalName: string
	readonly length: number
	status: 'queued' | 'preparing' | 'uploading' | 'finalizing' | 'committed' | 'failed'
	progress: number
	artifactId?: string
	error?: string
}
```

Chat exposes explicit begin, progress, finalize, commit, and fail transitions. The
selected intent's inline conversation renders a user-side file card with filename,
formatted size, progress bar, percentage, finalizing state, and committed artifact ID.
The generic actor projection may render a compact textual equivalent, but the inline
intent stream remains the primary UI.

On successful commit, append one compact model-visible user context record:

```text
Attached file:
originalName="contract.pdf"
artifactId="92e33385-e84d-4573-b5c3-4e5e9316ad11"
```

Do not send this as a new inference request. It becomes context for the next ordinary
user message. Do not add local paths, service credentials, upload claims, or transient
progress events to model history.

### 5. Errors and retry behavior

Failures stay in the chat in place. They must distinguish at least:

- unsupported drop shape;
- file unavailable or changed during upload;
- file too large;
- authentication required;
- Aven API unavailable;
- Artifact Store validation or authorization failure; and
- publication conflict or reconciliation-required state.

No failed state displays an artifact ID. A retry, when added to the card, reuses the
same publication UUID and exact metadata but may use a fresh upload claim. Epoch or
reconciliation errors must not be retried automatically.

## Verification plan

### Unit and contract tests

- SDK streaming upload preserves authorization, content declaration, and canonical
  publication behavior.
- Aven API rejects anonymous and unverified sessions.
- Request data cannot override user, publisher, or scope context.
- Filename validation strips no hidden path into durable payloads.
- The coordinator creates the exact `core.file@1` intent and stable root actor.
- Repeating the same publication UUID and exact file returns the original result.
- Mutating metadata under the same publication UUID conflicts.
- Tauri hashing and upload progress are incremental and monotonic.
- Chat attachment transitions reject invalid ordering and correlate events by upload
  ID.
- Only a committed attachment enters model-visible history.

### Integration test

Against the combined local Compose stack:

```text
authenticated file PUT to Aven API
  -> Artifact Store upload claim
  -> root publication
  -> artifact metadata read
  -> content read equals original bytes
  -> publication appears in feed
```

### Manual desktop acceptance

1. Start the combined local stack.
2. Start the Tauri application with
   `AVEN_IDENTITY_BASE_URL=http://localhost:3000` compiled into the native host.
3. Sign in with a local user that owns a name.
4. Drop a PDF, image, spreadsheet, or arbitrary binary file into the main window.
5. Confirm the intents workspace and selected intent detail open immediately.
6. Confirm the card shows a monotonic percentage during transfer.
7. Confirm it switches to finalizing after reaching 100%.
8. Confirm success displays the exact original name and full artifact UUID.
9. Retrieve the artifact and verify byte equality.
10. Send a subsequent chat message and confirm its model input contains the exact
    artifact reference.

## Explicitly deferred

- Browser-only HTML5 drag/drop and upload without the Tauri session host.
- Mobile/iOS document picking.
- Multiple files, directories, queues, cancellation, and background uploads.
- OCR, classification, previews, thumbnails, extraction, and automatic assistant
  replies.
- Active name selection and production name-to-scope routing.
- A durable publication outbox surviving a full application restart.
- The final per-request Artifact Store authorization-decision adapter.
- Raising the 100 MiB limit or changing the Artifact Store's current buffering model.

## Exit criteria

The slice is complete when a signed-in user can drop one regular file into the Tauri
window, observe accurate upload progress in the automatically opened intent detail,
and receive a committed chat attachment containing the exact original filename and
authoritative Artifact Store artifact ID. The service token must never enter the
webview, and the local path must never be retained in webview, chat, or model state.
The complete path must pass automated contract tests plus the local Compose acceptance
run.
