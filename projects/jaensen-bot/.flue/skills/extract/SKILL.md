---
name: extract
description: Extract structured data from documents - OCR, parsing, and dossier creation
---

# Extract Skill

This skill extracts structured information from documents. It processes archived files and creates knowledge dossiers.

## When to Use Extract

- Document needs content extraction
- Image needs OCR
- PDF needs text extraction
- Structured entities need to be identified

## Extract Worker Lifecycle

### Short-Lived Pattern
Extract workers are **one-shot**. Spawn, extract, complete.

### Workflow
1. **Receive archive path** → read binary
2. **Detect type** → choose extraction method
3. **Extract** → OCR/parse
4. **Structure** → create dossier
5. **Store** → register in Memory
6. **Report** → return dossier

### Specialty Naming
- `pdf-extract` - PDF text extraction
- `image-ocr` - OCR for images
- `doc-extract` - Word document parsing
- `email-extract` - Email analysis
- `structured-extract` - Already structured data (JSON/XML)

## Worker Capabilities

### `extract_from_archive(path)`
Extract content from archived document.

**Input:**
- `path`: Archive path from Ingest

**Output:**
```typescript
{
  content: string;
  entities: {
    people: string[];
    companies: string[];
    locations: string[];
    dates: string[];
    amounts: { value: number; currency: string }[];
  };
  summary: string;
  confidence: number;
}
```

### `ocr_image(imagePath)`
Perform OCR on image.

**Input:**
- `imagePath`: Path to image file

**Output:**
```typescript
{
  text: string;
  confidence: number;
  language: string;
}
```

### `create_dossier(data, options?)`
Store extraction results as dossier.

**Input:**
- `data`: Extracted data
- `options.entity?`: Primary entity name
- `options.type?`: Dossier type

**Output:**
- Confirmation with Memory reference

## Dossier Format

Dossiers are stored in Memory with standardized structure:

```typescript
interface Dossier {
  id: string;
  type: 'person' | 'company' | 'document' | 'event';
  primaryEntity: string;
  createdAt: Date;
  source: {
    archivePath: string;
    documentType: string;
  };
  content: {
    text: string;
    summary: string;
    entities: ExtractedEntities;
  };
  metadata: {
    confidence: number;
    extractor: string;
    extractionDate: Date;
  };
}
```

### Storage Location
```
.flue/memory/dossiers/<entity-type>/<entity-name>.md
```

## Extraction Methods

### PDF Extraction
- Use pdf-parse or similar
- Extract text layer if present
- Handle multi-page documents
- Preserve structure (headers, lists)

### Image OCR
- Use Tesseract or cloud OCR
- Detect language
- Preserve layout hints

### Document Parsing
- Handle DOCX XML structure
- Extract metadata
- Handle embedded images

## Routing Logic

### Task: "extract from /tmp/ingest/..."
1. Detect document type from path extension
2. Match to appropriate extractor specialty
3. Spawn worker with matched specialty
4. Execute: read → extract → create dossier → store

### Task: "process invoice"
1. Identify as financial document
2. Extract amounts, dates, vendor
3. Create structured dossier
4. Store in financial Memory thread

## Worker Completion

After completion:
1. Report dossier reference
2. Skill Agent removes worker from pool
3. Dispatcher notified for Intent update

## Max Workers
Default: 5 (short-lived, quick turnover)

## Dependencies
- Ingest Skill: Provides archive paths
- Memory Skill: For dossier storage