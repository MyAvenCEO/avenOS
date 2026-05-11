---
name: ingest
description: Download, archive, and register documents from URLs or file inputs
---

# Ingest Skill

This skill handles document ingestion - downloading content from URLs, archiving to filesystem, and registering metadata.

## When to Use Ingest

- User shares a URL to process
- Email attachment needs archiving
- External document needs to be captured
- Binary content needs to be stored

## Ingest Worker Lifecycle

### Short-Lived Pattern
Ingest workers are **one-shot**. They spawn, process one document, and complete.

### Workflow
1. **Receive URL/path** → download content
2. **Archive** → store binary to filesystem
3. **Extract metadata** → parse basic info
4. **Register** → store metadata in Memory
5. **Report** → return archive path

### Specialty Naming
- `url-handler` - generic URL download
- `pdf-handler` - PDF-specific processing
- `image-handler` - image download
- `email-handler` - email with attachments

## Worker Capabilities

### `ingest_url(url, options?)`
Download and archive content from URL.

**Input:**
- `url`: The URL to download
- `options.typeHint?`: Optional content type hint

**Output:**
```typescript
{
  archivePath: string;
  metadata: {
    url: string;
    contentType: string;
    size: number;
    downloadedAt: Date;
    filename?: string;
  }
}
```

### `ingest_email(attachment, metadata)`
Process email attachment.

**Input:**
- `attachment`: Binary content
- `metadata`: Email metadata (from, subject, date)

**Output:**
- Same as ingest_url

### `register_metadata(path, metadata)`
Register document metadata in Memory.

**Input:**
- `path`: Archive path
- `metadata`: Document metadata

**Output:**
- Confirmation with Memory reference

## Archive Storage

### Location
```
/tmp/ingest/<timestamp>-<hash>.<ext>
```

### Structure
```
/tmp/ingest/
├── 2024-05-11-abc123.pdf
├── 2024-05-11-def456.jpg
└── metadata/
    └── <archive-name>.meta.json
```

### Metadata Format
```json
{
  "archivePath": "/tmp/ingest/2024-05-11-abc123.pdf",
  "originalUrl": "https://...",
  "contentType": "application/pdf",
  "size": 12345,
  "ingestedAt": "2024-05-11T10:30:00Z",
  "source": "user" | "email" | "webhook",
  "hash": "sha256:..."
}
```

## Content Type Handling

| Type | Handler Specialty | Special Processing |
|------|------------------|-------------------|
| PDF | pdf-handler | Extract basic metadata, check for text |
| Image (jpg/png) | image-handler | Check dimensions, basic EXIF |
| HTML | url-handler | Download, archive, strip scripts |
| DOC/DOCX | url-handler | Archive for later extraction |
| Email | email-handler | Parse headers, extract attachments |

## Routing Logic

### Task: "ingest https://..."
1. Detect content type from URL/headers
2. Match to appropriate handler specialty
3. Spawn worker with matched specialty
4. Execute download → archive → register flow

### Task: "email attachment"
1. Parse email metadata
2. Detect attachment types
3. Spawn workers per attachment
4. Aggregate metadata

## Worker Completion

After completion:
1. Report archive path and metadata
2. Skill Agent removes worker from pool
3. Dispatcher notified for Intent update

## Max Workers
Default: 5 (short-lived, quick turnover)

## Dependencies
- Memory Skill: For metadata registration
- Extract Skill: Triggered after ingest for document processing