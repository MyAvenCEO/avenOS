# Document model gateway

## Purpose

The document model gateway is a small, authenticated structured-output adapter between
Aven clients and one operator-selected OpenAI-compatible multimodal model. It keeps the
provider credential and provider-specific request format on the server while allowing a
trusted Aven client to own its prompts, JSON schemas, orchestration, validation, and
artifact materialization.

The gateway is independently useful without the Artifact Store or the document runtime:
an authenticated client can call `GET /api/model/document` to discover availability and
`POST /api/model/document` to execute one supported structured multimodal procedure.

"Standalone" has two deliberate qualifications:

1. The HTTP route is hosted by Aven API and uses its verified-user session. It is not a
   separately deployable anonymous service.
2. It is a document-understanding gateway, not a general chat-completions proxy. The
   contract version, procedure names, image representation, and structured-output modes
   are allowlisted.

This is the intended boundary:

```text
trusted client
  owns images, extracted text, prompt, schema and result validation
       |
       | Aven session + bounded domain request
       v
Aven API /api/model/document
  authenticates, bounds, adds safety context, selects provider profile
       |
       | provider credential + OpenAI-compatible chat/completions request
       v
configured multimodal model
       |
       | one structured object + provider metadata
       v
gateway receipt -> client -> optional Artifact Store production run
```

## Non-goals

The gateway does not:

- inspect files, render PDFs, perform OCR, or split documents into pages;
- select a procedure, model, or downstream actor dynamically;
- accept arbitrary chat messages, roles, tools, model names, URLs, or provider keys;
- execute tool calls returned by a model;
- validate business rules or persist model output;
- publish artifacts or production runs;
- retry, cache, queue, stream, or batch provider requests;
- prove that a client-supplied prompt or schema is an approved Aven implementation.

These omissions keep the gateway a transport and compatibility boundary rather than a
second orchestration system.

## Components

| Component | Responsibility |
| --- | --- |
| `services/aven-api/src/routes/api/model/document/+server.ts` | Authentication, HTTP request validation, status and completion endpoints |
| `services/aven-api/src/lib/server/document-model.ts` | Bounds, provider request construction, provider response parsing, receipts |
| `services/aven-api/src/lib/server/config.ts` | Environment parsing and fail-fast security validation |
| `app/src/lib/actors/document-model.ts` | Current client contract, prompts, schemas, request and receipt types |
| `app/src-tauri/src/artifacts.rs` | Keeps the Aven session token out of the webview and transports requests |

`DocumentModelService.fromConfig(config)` returns `null` when the feature is disabled.
Aven API stores that value in its runtime and exposes it through the route. The service
itself has no Artifact Store dependency and accepts an injected `fetch`, which makes it
usable and testable independently of the HTTP route.

## Authentication

Both endpoints require an authenticated Aven user whose email is verified. Clients send
their Aven session credential, normally as:

```http
Authorization: Bearer <aven-session-token>
```

This is not the model-provider credential. Aven API reads the provider credential from
its environment and never returns it to the client.

Authentication failures use the normal Aven API error shape:

```json
{
  "code": "AUTHENTICATION_REQUIRED",
  "message": "Sign in is required."
}
```

## Availability endpoint

### `GET /api/model/document`

Successful response:

```json
{
  "available": true,
  "maxPages": 15
}
```

`available` means the gateway passed startup configuration and was constructed. It is
not a provider health check and does not prove that the credential, model, quota, or
network path currently works. Clients discover real provider availability only by
making a completion request.

`maxPages` is returned even when `available` is false so callers can retain one response
shape. Clients must not render or submit model images when availability is false.

Example:

```sh
curl -sS \
  -H "Authorization: Bearer $AVEN_SESSION_TOKEN" \
  https://api.example.test/api/model/document
```

## Completion endpoint

### `POST /api/model/document`

Required header:

```http
Content-Type: application/json
Authorization: Bearer <aven-session-token>
```

Request fields:

| Field | Required | Contract |
| --- | --- | --- |
| `procedure` | yes | One of the four allowlisted procedures below |
| `contractVersion` | yes | Exactly `aven-finance-vision-v2` |
| `prompt` | yes | Non-empty, at most 12,000 JavaScript characters |
| `schema` | yes | JSON object describing the expected result |
| `images` | yes | 1–63 PNG/JPEG data objects, further limited by configured `maxPages` |
| `documentText` | yes | String; at most 2,000,000 characters at the route and 2 MiB UTF-8 in the service |
| `expectedKind` | no | One allowlisted invoice/statement orchestration decision |

Each image has this shape:

```json
{
  "page": 1,
  "mediaType": "image/png",
  "base64": "<canonical-base64-without-a-data-url-prefix>"
}
```

`page` is an integer from 1 through 63. `mediaType` is exactly `image/png` or
`image/jpeg`. `base64` must be canonical: decoding and encoding it again must produce
the identical string. The gateway constructs the provider data URL itself.

Example classification request:

```sh
curl -sS https://api.example.test/api/model/document \
  -H "Authorization: Bearer $AVEN_SESSION_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{
  "procedure": "classify-document",
  "contractVersion": "aven-finance-vision-v2",
  "prompt": "Classify the complete visible document.",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["resolvedKind"],
    "properties": {
      "resolvedKind": {
        "type": "string",
        "enum": ["invoice", "bank-statement", "payment-receipt", "unknown"]
      }
    }
  },
  "images": [
    {
      "page": 1,
      "mediaType": "image/png",
      "base64": "REPLACE_WITH_CANONICAL_BASE64"
    }
  ],
  "documentText": "Invoice 42\nTotal EUR 12.00"
}
JSON
```

The example placeholder must be replaced with real canonical base64 before sending.
For large images, generating the JSON request in code is safer than passing it through
the shell.

## Supported procedures

| Procedure | Provider function/schema name | Image rule | Intended result |
| --- | --- | --- | --- |
| `analyze-page` | `analyze_page` | Exactly one image | Page transcription, layout and visual classification |
| `classify-document` | `classify_document` | One through configured maximum | Complete-document kind classification |
| `extract-invoice` | `extract_invoice` | One through configured maximum | Grounded invoice-family candidate/details |
| `extract-statement` | `extract_account_statement` | One through configured maximum | Grounded account statement or payment receipt |

The procedure determines only the provider function name and description. The client
still supplies the prompt and schema. The current canonical prompts and schemas live in
`app/src/lib/actors/document-model.ts` and should be used by AvenOS actors.

`expectedKind`, when present, must be one of:

```text
invoice, credit-note, receipt, self-issued-receipt, mandate,
order-confirmation, offer, reminder, bank-statement, payment-receipt
```

The gateway adds it as a trusted orchestration decision instructing extraction to retain
that exact kind. Document content never controls this field.

## Provider request construction

The configured base URL is treated as an API root. The gateway appends
`chat/completions`, so a base URL of `https://api.openai.com/v1` produces:

```text
https://api.openai.com/v1/chat/completions
```

Do not configure the full `chat/completions` URL.

The gateway builds two messages:

1. A fixed system prompt identifies the model as a document-understanding adapter and
   tells it to treat document contents as untrusted data.
2. A user message begins with a fixed prompt-injection rule, followed by the client
   prompt, delimited extracted text, the optional trusted kind, page labels, and
   high-detail image data URLs.

The client cannot add arbitrary roles or messages. Provider redirects are rejected.
The provider request uses `temperature: 0` for all profiles.

## Provider profiles

The gateway normalizes one domain request into four common OpenAI-compatible structured
output dialects.

| Profile | Provider request | Provider response expected |
| --- | --- | --- |
| `openai-tools` | One strict function tool, forced `tool_choice`, parallel calls disabled | Exactly one tool call with the expected function name and object/JSON-string arguments |
| `openai-json-schema` | Strict `response_format: json_schema` | JSON object in message `content` |
| `qwen-tools` | One strict forced function tool with the full schema | Exactly one matching tool call |
| `generic-json` | `response_format: json_object`; full schema appended as a user message | JSON object in message `content` |

For the two `openai-*` profiles, the gateway recursively removes `$schema`, `minLength`,
`maxLength`, and `uniqueItems` before sending the schema. This preserves compatibility
with the strict-schema subset accepted by the configured provider. Qwen and generic JSON
profiles receive the supplied schema without that transformation.

`generic-json` is the least constrained mode: the schema is instructional rather than
provider-enforced. Downstream validation is especially important for that profile.

Provider response content may be a JSON string or an array of text parts. A single
outer Markdown JSON fence is tolerated. The parsed value must be a JSON object.

## Success response and receipt

The gateway returns the structured object and a reproducibility receipt directly:

```json
{
  "structured": {
    "resolvedKind": "invoice"
  },
  "receipt": {
    "providerRequestId": "chatcmpl-provider-id",
    "httpRequestId": "provider-http-request-id",
    "model": "gpt-4.1-2026-08-01",
    "profile": "openai-json-schema",
    "usage": {
      "prompt_tokens": 120,
      "completion_tokens": 8
    },
    "requestKey": "<sha256>",
    "promptDigest": "<sha256>",
    "implementationDigest": "<sha256>"
  }
}
```

Receipt fields:

| Field | Meaning |
| --- | --- |
| `providerRequestId` | Provider response `id`, or `null` |
| `httpRequestId` | Provider `x-request-id` header, or `null` |
| `model` | Model reported by the provider, falling back to configured model |
| `profile` | Gateway profile used for request and response normalization |
| `usage` | Provider usage object when present; shape is provider-specific |
| `requestKey` | SHA-256 of endpoint, a separator byte, and exact serialized provider request body |
| `promptDigest` | SHA-256 of fixed system/safety text and client prompt |
| `implementationDigest` | SHA-256 of profile, configured model, endpoint and contract version |

`requestKey` is also sent upstream as the `Idempotency-Key` header. Equal exact provider
requests to the same endpoint receive the same key. JSON property ordering is part of
the serialized body, so semantically equivalent schemas with different key ordering may
produce different keys.

The gateway does not persist receipts. A caller that needs durable lineage should store
the receipt with its output or, as AvenOS does, include it in an Artifact Store
production-run receipt.

## Input and response bounds

| Resource | Limit |
| --- | --- |
| Logical page number | 1–63 |
| Images per request | 1 through configured maximum; default 15, hard maximum 63 |
| `analyze-page` images | Exactly 1 |
| Encoded image field | 16,800,000 characters at HTTP validation |
| Decoded single image | 12 MiB |
| Decoded images in one request | 40 MiB total |
| Extracted text | 2,000,000 characters and at most 2 MiB UTF-8 |
| Client prompt | 12,000 characters |
| Provider response body | 2 MiB |
| Provider timeout | 5–900 seconds; default 180 |

The route has no gateway-specific aggregate byte limit for the supplied JSON schema;
normal reverse-proxy and application request-body limits must therefore remain enabled.
The service validates declared media type and canonical base64 but does not inspect image
magic bytes or dimensions. Trusted clients are responsible for rendering legitimate,
bounded page images before calling it.

## Error contract

Errors use:

```json
{
  "code": "DOCUMENT_MODEL_PAGE_LIMIT",
  "message": "Model page count is outside its limit."
}
```

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Route request shape, enum or length failed |
| 400 | `DOCUMENT_MODEL_CONTRACT_INVALID` | Direct service caller used an unsupported contract |
| 400 | `DOCUMENT_MODEL_PROCEDURE_INVALID` | Direct service caller used an unsupported procedure |
| 400 | `DOCUMENT_MODEL_PAGE_LIMIT` | Image count violates procedure/configuration bounds |
| 400 | `DOCUMENT_MODEL_IMAGE_INVALID` | Invalid page or non-canonical base64 |
| 401 | `AUTHENTICATION_REQUIRED` | Aven session absent or invalid |
| 403 | `EMAIL_VERIFICATION_REQUIRED` | Authenticated user is not verified |
| 413 | `DOCUMENT_MODEL_TEXT_TOO_LARGE` | UTF-8 text exceeds 2 MiB |
| 413 | `DOCUMENT_MODEL_IMAGE_TOO_LARGE` | One decoded image exceeds 12 MiB |
| 413 | `DOCUMENT_MODEL_IMAGES_TOO_LARGE` | Decoded images exceed 40 MiB total |
| 429 | `DOCUMENT_MODEL_UPSTREAM_ERROR` | Provider returned HTTP 429 |
| 502 | `DOCUMENT_MODEL_UPSTREAM_ERROR` | Provider returned another non-success status |
| 502 | `DOCUMENT_MODEL_INVALID_RESPONSE` | Provider response or structured result is malformed |
| 502 | `DOCUMENT_MODEL_RESPONSE_TOO_LARGE` | Provider response exceeds 2 MiB |
| 503 | `DOCUMENT_MODEL_UNAVAILABLE` | Gateway disabled, network error, or timeout |

Provider error bodies are not forwarded. This avoids leaking provider details but means
operators should correlate the client error with provider request logs when debugging.

## Retries, timeouts and idempotency

The proxy performs one provider call and never retries. Callers decide whether a
procedure is safe to retry. AvenOS currently makes at most three attempts for
model-backed actor stages, waiting 500 ms and then 1,000 ms.

Because the gateway recreates the same provider request and idempotency key, retrying an
unchanged request is safe for providers that honor `Idempotency-Key`. The gateway cannot
guarantee provider support for that header, so callers must still treat responses as
repeatable derivations rather than external side effects.

Caller, ingress and load-balancer timeouts must exceed
`ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS` plus network overhead. The current generic
Tauri `intent_json` bridge uses a 20-second transport timeout; deployments that expect
longer model latency must raise or specialize that bridge timeout before relying on the
server's 180-second default.

## Security and privacy properties

The gateway provides these controls:

- verified Aven-user authentication on status and completion;
- provider credentials available only to Aven API;
- operator-configured upstream URL, model and profile—never caller-selected;
- HTTPS required unless insecure HTTP is explicitly enabled;
- HTTP(S)-only base URL without credentials, query string, or fragment;
- redirects disabled to prevent credential forwarding;
- no client-supplied remote image URLs; images become local data URLs;
- fixed prompt-injection warnings before client prompt and document content;
- canonical base64, byte, page, timeout and response bounds;
- fixed procedure and contract allowlists;
- structured error responses that do not include upstream bodies.

The gateway still sends rendered pages, extracted text, the prompt, and the schema to the
configured provider. Before enabling it, approve the provider account, processing
region, retention policy, access controls, contractual terms, and model-specific data
usage settings.

Model output remains untrusted. The gateway ensures that it can parse one object and,
where supported, asks the provider to follow the schema. It does not independently run a
JSON Schema validator against `structured`. Callers must validate the returned object
and all domain invariants before persisting it or taking action.

Because trusted authenticated clients supply prompt and schema, this route should not be
exposed as a public developer API without additional procedure-specific schema pinning,
rate limits, quotas, and authorization policy.

## Configuration

Production/OpenAI example:

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

Local OpenAI-compatible endpoint from Docker:

```dotenv
ARTIFACT_PROCESSOR_VISION_ENABLED=true
ARTIFACT_PROCESSOR_VISION_BASE_URL=http://host.docker.internal:8000/v1
ARTIFACT_PROCESSOR_VISION_MODEL=local-vision-model
ARTIFACT_PROCESSOR_VISION_PROFILE=generic-json
ARTIFACT_PROCESSOR_VISION_AUTH_MODE=none
ARTIFACT_PROCESSOR_VISION_MAX_PAGES=15
ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS=180
ARTIFACT_PROCESSOR_VISION_ALLOW_INSECURE_HTTP=true
```

Configuration constraints:

| Variable | Constraint/default |
| --- | --- |
| `ARTIFACT_PROCESSOR_VISION_ENABLED` | `true` or `false`; default `false` |
| `ARTIFACT_PROCESSOR_VISION_BASE_URL` | Required when enabled; HTTP(S), no credentials/query/fragment; HTTPS by default |
| `ARTIFACT_PROCESSOR_VISION_MODEL` | Required when enabled; 1–255 characters, no whitespace |
| `ARTIFACT_PROCESSOR_VISION_PROFILE` | `openai-tools`, `openai-json-schema`, `qwen-tools`, or `generic-json`; default `openai-tools` |
| `ARTIFACT_PROCESSOR_VISION_AUTH_MODE` | `bearer` or `none`; default `bearer` |
| `ARTIFACT_PROCESSOR_VISION_API_KEY` | Required for bearer mode; 20–512 non-whitespace characters |
| `ARTIFACT_PROCESSOR_VISION_MAX_PAGES` | Integer 1–63; default 15 |
| `ARTIFACT_PROCESSOR_VISION_TIMEOUT_SECONDS` | Integer 5–900; default 180 |
| `ARTIFACT_PROCESSOR_VISION_ALLOW_INSECURE_HTTP` | `true` or `false`; default `false` in schema |

The local Compose overlay intentionally defaults insecure HTTP to `true` for a model on
the Docker host. Production deployment must explicitly retain `false`.

## Minimal TypeScript client

```ts
interface GatewayReceipt {
  providerRequestId: string | null
  httpRequestId: string | null
  model: string
  profile: string
  usage: Record<string, unknown> | null
  requestKey: string
  promptDigest: string
  implementationDigest: string
}

async function completeDocumentModel(
  apiBaseUrl: string,
  sessionToken: string,
  request: Record<string, unknown>
): Promise<{ structured: Record<string, unknown>; receipt: GatewayReceipt }> {
  const response = await fetch(`${apiBaseUrl}/api/model/document`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(request)
  })

  const body = await response.json()
  if (!response.ok) {
    throw new Error(`${body.code ?? 'MODEL_ERROR'}: ${body.message ?? response.status}`)
  }
  return body
}
```

Production clients should additionally:

- check the status endpoint before rendering images;
- use an abort timeout longer than the configured provider timeout;
- validate `structured` against the exact local schema;
- verify domain invariants independently of JSON shape;
- retry only bounded, side-effect-free derivations;
- persist the receipt beside any durable output;
- avoid logging request bodies, images, extracted text, tokens, or provider keys.

## Operations and observability

The gateway currently has no queue, database table, metrics collector, or gateway-owned
audit log. Operational evidence comes from:

- Aven API availability and structured error codes;
- provider request IDs and usage returned in the receipt;
- provider-side dashboards/logs;
- downstream Artifact Store production runs when the caller publishes the receipt.

Recommended production telemetry, if added, should count requests, latency, result code,
procedure, configured model/profile, retry source, and token usage. It must not record
document text, base64 images, client prompts, schemas containing sensitive literals,
session credentials, or provider credentials.

Alert on sustained `DOCUMENT_MODEL_UNAVAILABLE`, provider 429 responses, malformed model
output, response-limit failures, and latency approaching the caller timeout.

## Verification

Run the focused service tests:

```sh
cd services/aven-api
bun x vitest run tests/document-model.test.ts
```

Run the complete API checks:

```sh
bun run check:api
bun run test:api
bun run build:api
```

For a provider compatibility smoke test:

1. Start Aven API with the gateway enabled.
2. Authenticate a verified test user.
3. Confirm the status endpoint reports the configured page limit.
4. Submit one small real PNG using `analyze-page` and a strict object schema.
5. Confirm the result is an object and the receipt reports the intended model/profile.
6. Repeat an identical request and confirm `requestKey` is unchanged.
7. Submit malformed base64, too many pages, and an unsupported contract; confirm each
   fails before useful provider work is performed.
8. Confirm provider errors do not expose the provider response body to the client.

## Reuse and future extraction

The current gateway is a good reusable primitive for other trusted document actors when
they can express their result as a bounded JSON object and fit one of the four semantic
procedures. Reuse the `DocumentModelGateway` interface rather than binding actors to
Tauri or HTTP.

If broader model use is needed, add a new versioned domain gateway or an allowlisted
procedure with a server-owned policy. Do not turn this endpoint into arbitrary
model/prompt passthrough. A separately deployed service would also need replacements for
Aven session authentication, configuration loading, rate limiting, quotas, logging, and
tenant-aware authorization; `DocumentModelService` itself is otherwise independent of
Artifact Store and document orchestration.

Related documentation:

- [Client-owned document ingestion](client-document-ingest.md)
- [Actor skills and goal-directed problem solving](actor-skills-and-problem-solving.md)
- [Aven API GitHub deployment](../services/aven-api/docs/github-deployment.md)
