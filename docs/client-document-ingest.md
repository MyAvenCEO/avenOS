# Client-owned document ingestion

## Outcome

New desktop/share-sheet uploads use `sourceKind: client-actor-ingest`. The legacy
Artifact Processor deliberately ignores that source kind. The AvenOS client now owns
the complete document-understanding workflow that was previously implemented by the
server processor:

```text
document-inspector
  -> document-decomposer
  -> native-text-extractor (per page)
  -> document-kind-classifier (model)
  -> visual-page-analyzer (model, per page)
  -> document-assembler
  -> content-aggregator
  -> invoice-extractor OR statement-extractor (model)
  -> invoice-validator OR statement-validator (deterministic)
```

When the model gateway reports that vision is disabled, or when a document exceeds its
configured model-page limit, the same actors select the deterministic lane:

```text
native-text-extractor -> page-signal-classifier -> document-assembler -> content-aggregator
```

That fallback does not invent OCR or document meaning. A scanned PDF consequently
settles as `needs_review`; a text PDF can still complete as a generic document.

## Responsibility boundary

### AvenOS client

The client owns all document logic:

- magic-byte inspection and bounded PDF/image decoding;
- 144-DPI PDF page rendering and removal of non-visual JPEG trailing bytes;
- native text and normalized-millionth layout extraction;
- the `aven-finance-vision-v2` prompts and JSON contracts;
- actor orchestration and invoice-versus-statement branching;
- model-output materialization, classification thresholding, evidence filtering, and
  kind-conflict checks;
- `invoice-core-v1` and `statement-core-v1` deterministic validation;
- durable production-run publication and the user-facing processing projection.

The canonical finance payload schemas are imported from the Artifact Store protocol
fixtures, so the client and store do not maintain separate invoice, statement, and
classification shapes.

### Aven API model gateway

`POST /api/model/document` is deliberately a small authenticated inference proxy. It
does not inspect, split, OCR, classify, extract, validate, plan, persist, or retry a
document. It:

- authenticates the AvenOS session;
- accepts only `analyze-page`, `classify-document`, `extract-invoice`, and
  `extract-statement` under `aven-finance-vision-v2`;
- enforces page, byte, media-type, timeout, canonical-base64, and response bounds;
- formats the client-supplied prompt/schema for one configured OpenAI-compatible
  provider profile;
- keeps the provider credential out of the webview;
- disables redirects and sends a stable `Idempotency-Key`;
- parses the configured structured-output lane and returns the object with a bounded
  model/usage receipt.

`GET /api/model/document` reports only `{ available, maxPages }`. The client checks it
before decoding so it does not render page images for a disabled lane.

The complete standalone HTTP/service contract, provider profiles, bounds, errors,
security properties, receipts, and integration examples are documented in the
[document model gateway guide](document-model-gateway.md).

The supported provider profiles are unchanged from the legacy processor:

| Profile | Provider request |
| --- | --- |
| `openai-tools` | One forced strict function call |
| `openai-json-schema` | Strict `response_format: json_schema` |
| `qwen-tools` | One forced function call using the complete schema |
| `generic-json` | JSON object mode plus the schema as a user message |

The model is not hard-coded. `ARTIFACT_PROCESSOR_VISION_MODEL` names the exact
vision-capable deployment. The current deployment guide uses `gpt-4.1` with
`openai-json-schema`; local examples use `Qwen/Qwen3.6-27B` with `qwen-tools`.

### Artifact publication gateway

`POST /api/artifacts/client-runs/[publicationId]` remains a separate narrow adapter.
It resolves the authenticated tenant scope, accepts only named client procedures,
validates their exact input/output slots and blob policy, uploads result blobs, and
publishes the production run atomically.

Model procedures are recorded with `implementation.deterministic: false` and retain
their provider request ID, HTTP request ID, model, profile, usage, request key, prompt
digest, and implementation digest in the run receipt. Deterministic procedures remain
marked deterministic.

This is protocol validation, not remote attestation. The authenticated user is the run
initiator; the logical agent ID identifies which built-in actor the client claims to
have executed. These outputs are tenant data and do not gain operator authority merely
because they name a built-in actor.

## Parity with the legacy processor

The client lane preserves the server behavior that matters:

- 25 MiB source limit and at most 63 logical pages;
- provider page limit configurable from 1 through 63, default 15;
- PDF pages rendered at 144 DPI;
- 40-million-pixel image bound, 12 MiB rendered-page bound, and 40 MiB total model
  image bound;
- 2 MiB native/document text bound, 200,000-byte page OCR bound, and 512 layout spans;
- page OCR plus layout, page content classification, and content description;
- complete-document classification with the 6,500-basis-point acceptance threshold;
- the complete invoice-family taxonomy and statement/payment-receipt split;
- grounded invoice candidate/details and statement candidate artifacts;
- extraction-kind conflict rejection;
- target-relative JSON-pointer evidence attached to exact page regions;
- invoice arithmetic/identity validation and statement balance/period/receipt-shape
  validation;
- three bounded attempts for model-backed stages, with retry state visible in the
  processing projection;
- immutable step outputs and model receipts in Artifact Store lineage.

One scheduling difference is intentional: the legacy server can lease model steps to
parallel workers, while the local actor mailbox serializes them. The artifact graph and
results are equivalent; a later headless client host can parallelize actors without
changing their contracts.

## Resumption and idempotency

Every actor invocation publishes a separate production run. The next envelope is bound
to the returned artifact IDs, making durable lineage the inter-actor data path.

Publication UUIDv8 values derive from the source artifact, stage key, concrete
procedure, and ordered input artifact slots. This matters when a document first runs
through deterministic fallback and is later retried with vision enabled: the OCR
assembly has different inputs and cannot replay the earlier native-only assembly.

Provider request identities derive from the endpoint and canonical request body. If the
client retries after an interrupted response/publication boundary, the proxy sends the
same provider idempotency key. Once the Artifact Store accepts a publication, another
retry is a replay rather than a duplicate derivation.

Model-backed stages make at most three attempts, waiting 500 ms and then 1,000 ms.
Deterministic stages fail immediately because repeating the same local transformation
cannot repair its input. A failed in-memory presentation may be started again; completed
and `needs_review` presentations remain terminal. After an application restart, stable
publication identities let the Artifact Store replay already committed steps while the
runtime reconstructs the remaining graph.

## Configuration

The Aven API and, during migration, the legacy Artifact Processor use the same
environment variables:

```dotenv
ARTIFACT_PROCESSOR_VISION_ENABLED=true
ARTIFACT_PROCESSOR_VISION_BASE_URL=https://api.openai.com/v1
ARTIFACT_PROCESSOR_VISION_MODEL=gpt-4.1
ARTIFACT_PROCESSOR_VISION_PROFILE=openai-json-schema
ARTIFACT_PROCESSOR_VISION_AUTH_MODE=bearer
ARTIFACT_PROCESSOR_VISION_API_KEY=replace-with-provider-secret
ARTIFACT_PROCESSOR_VISION_MAX_PAGES=15
ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS=180
ARTIFACT_PROCESSOR_VISION_ALLOW_INSECURE_HTTP=false
```

`ARTIFACT_PROCESSOR_VISION_ALLOW_INSECURE_HTTP=true` is only for a local model endpoint.
Provider credentials must be supplied to the API container/process; they are never
compiled into AvenOS and never returned by the status or completion endpoint.

## Operator checklist

1. Choose and provision an OpenAI-compatible, vision-capable deployment. Confirm that
   it supports the selected structured-output profile and high-detail image input.
2. Put the eight vision variables above in the Aven API environment. For the supplied
   Compose overlays, use the same values already supplied to the legacy processor; the
   overlays now pass them into the `app` service as well.
3. Keep `ARTIFACT_PROCESSOR_VISION_ALLOW_INSECURE_HTTP=false` outside local development.
   For a local model on the Docker host, set it to `true` and use
   `http://host.docker.internal:<port>/v1`.
4. Deploy/restart the Aven API and confirm an authenticated
   `GET /api/model/document` returns `{"available":true,"maxPages":15}` (or the limit
   you configured). A false result deliberately activates deterministic fallback.
5. Deploy an AvenOS build containing the new Tauri commands
   `document_model_status` and `document_model_complete`. No provider key belongs in
   the desktop bundle.
6. Keep Artifact Store and Intent Service connectivity configured as before. Client
   model outputs are not considered complete until their production runs commit.
7. Upload three smoke fixtures from AvenOS: a text PDF invoice, a scanned invoice, and
   a bank statement/payment receipt. Verify the processing graph contains model page
   analysis, typed extraction, validation, and derived artifacts with model receipts.
8. Verify a disabled model configuration produces deterministic fallback and an honest
   `needs_review` result for the scanned fixture.
9. After the client rollout is established, disable legacy processor discovery/model
   execution as a separate migration. Do not remove the shared protocol fixtures or
   conformance tests.

## Rollout and removal of the legacy lane

During rollout, both the API gateway and legacy processor may receive the vision
configuration. They cannot race for new uploads because `client-actor-ingest` is
explicitly excluded from processor discovery.

After deployed AvenOS versions using the client lane are established, the processor's
vision configuration and model execution can be removed independently. Keep its
protocol fixtures and conformance tests as the shared artifact contract until those
schemas move into a dedicated package.
