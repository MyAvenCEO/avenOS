---
name: ingest
description: Download, archive, and register documents from URLs or file inputs
---

# Ingest Skill

This skill handles document ingestion: downloading content from URLs or accepting file inputs, then archiving them into Jaensen storage.

## When to Use Ingest

- User shares a URL to process
- Email attachment needs archiving
- External document needs to be captured
- Binary content needs to be stored

## Current Runtime Reality

- Ingest workers are **short-lived sandbox executions**.
- Supported operations are:
  - `archive-url`
  - `archive-attachment`
- The durable archive is stored under `.flue/archive/` in Jaensen storage.
- After a successful ingest, the runtime automatically queues `extract.extract-text` for the archived file unless an extract action is already queued.

### Workflow
1. Receive URL or attachment
2. Archive file content into storage
3. Return the archive key
4. Queue follow-up extraction in the dispatcher/runtime

### Worker Type
- The sandbox worker type currently matches the selected operation name.

## Worker Capabilities

### `archive-url`
Download and archive content from a URL.

**Input:**
- `url`: The URL to download

**Output:**
- Archive key
- Source URL

### `archive-attachment`
Archive an attachment supplied in the Jaensen input.

**Input:**
- Attachment content from the normalized Jaensen input
- If `archiveKey` is already present, the runtime reuses the existing archived file instead of writing it again

**Output:**
- Archive key
- Attachment name, if available

## Archive Storage

### Location
```
.flue/archive/<key>
```

### Structure
```
.flue/archive/
├── <key>
└── <key>.meta.json
```

### Metadata Format
```json
{
  "key": "archive-...",
  "originalUrl": "https://...",
  "contentType": "application/pdf",
  "metadata": {
    "name": "Invoice.pdf",
    "source": "owner-upload"
  }
}
```

## Notes

- URL ingestion uses `fetch` in the runtime.
- Attachment ingestion can reuse a previously archived upload via `archiveKey`.
- The runtime, not the worker, currently performs archive persistence.
- Follow-up extraction is automatically queued by the dispatcher/runtime after successful ingest.