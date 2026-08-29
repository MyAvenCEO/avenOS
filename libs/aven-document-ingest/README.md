# `@avenos/document-ingest`

Headless document-ingestion actors and the current Artifact Store-backed document
coordinator.

For the complete desktop-to-server architecture, execution sequences, persistence
boundaries, and source map, see
[`docs/document-ingest-system.md`](../../docs/document-ingest-system.md).

The package owns:

- document source, page, classification, finance, and validation contracts;
- deterministic and model-backed actor manifests and procedures;
- prompts and structured-output schemas;
- capability-based document-model selection;
- placement-frozen local/server host contracts; and
- current DAG execution, stable publication identities, retry checkpoints, and
  processing projections.

It depends on the portable actor, Artifact Store, and LLM contracts plus PDF.js for
the headless deterministic decoder. It does not import Svelte, Tauri, or browser APIs.
Consequently the actor definitions run in the desktop app and the Actor Runner. The
current `DocumentProcessingRuntime` coordinator still has document-specific dynamic
fan-out and is not the generic fixed-cardinality planner.

## Actor inventory

Every built-in actor owns one directory under `src/actors`. The directory name is the
actor manifest ID, so listing that directory is the authoritative at-a-glance catalog:

| Actor directory | Method | Lane |
| --- | --- | --- |
| `document-inspector/` | `document_inspect` | Deterministic |
| `document-decomposer/` | `document_decompose` | Deterministic |
| `native-text-extractor/` | `document_extract_native_text` | Deterministic |
| `page-signal-classifier/` | `document_classify_page` | Deterministic |
| `document-assembler/` | `document_assemble` | Deterministic |
| `content-aggregator/` | `document_aggregate_content` | Deterministic |
| `visual-page-analyzer/` | `document_analyze_page` | Vision model |
| `document-kind-classifier/` | `document_classify_kind` | Vision model |
| `invoice-extractor/` | `document_extract_invoice` | Vision model |
| `statement-extractor/` | `document_extract_statement` | Vision model |
| `invoice-validator/` | `document_validate_invoice` | Deterministic |
| `statement-validator/` | `document_validate_statement` | Deterministic |

Each directory exports a named factory and can be imported directly, for example:

```ts
import { createDocumentInspectorActor } from '@avenos/document-ingest/actors/document-inspector'
```

`src/actors/registry.ts` is the composition root that constructs the standard graph.
`src/shared.ts` contains only cross-actor contracts and pure helpers; it contains no
actor implementation.

## Host adapters

A host supplies three concrete edges:

1. a `DocumentDecoder` for bounded PDF/image inspection and rendering;
2. an `LlmGatewayClient` for catalog discovery and completion; and
3. a `ClientArtifactGateway` for atomic output/provenance publication.

The desktop implementations remain intentionally thin:

- `app/src/lib/artifacts/browser-document-decoder.ts` uses browser/PDF.js facilities;
- `app/src/lib/actors/document-llm-gateway.ts` binds the generic Tauri LLM client; and
- `app/src/lib/artifacts/client-document-processing.ts` registers actors and binds the
  Tauri Artifact Store command.

Artifact publication is wrapped in `QueuedClientArtifactGateway`. It serializes local
publications, retries only host-declared transient failures, and preserves the stable
`publicationId`, so backpressure cannot duplicate a committed production run.

`DocumentExecutionRouter` chooses one `DocumentExecutionHost` per process. Device
placement uses the in-process host. Server placement uses `RemoteDocumentExecutionHost`
to submit the document skill through the authenticated Plan Runner facade. The
separate Actor Runner owns the customer-scoped SQL run ledger, reads and publishes
through tenant-routed Artifact Store access, and returns the durable presentation in
the run checkpoint. `src/server.ts` supplies its bounded text/PDF decoder, publication
adapter, and application executor. See
[`docs/actor-runtime-formal-spec.md`](../../docs/actor-runtime-formal-spec.md) for the
wire protocol and generic executor boundary.

The application imports these package subpaths directly; no application compatibility
re-export remains.
