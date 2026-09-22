# `@avenos/llm-client`

Provider- and transport-neutral contracts for clients of the authenticated Aven LLM
gateway.

The package defines model descriptors, capability names, multimodal messages,
structured-output requests, normalized responses and receipts, plus the minimal
`LlmGatewayClient` port:

```ts
interface LlmGatewayClient {
  discover(requiredCapabilities: string[]): Promise<LlmModelDescriptor[]>
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResponse>
}
```

The root contract contains no Tauri, retry, model-selection or task-specific prompt
logic. The `http` subpath provides the service-authenticated adapter, including raw
OpenAI-compatible chat streaming. It uses only its host-configured gateway URL,
does not follow redirects and never retries a request implicitly. The host owns
the credential; raw upstream error bodies do not become client errors. Consumers
use `supportsCapabilities` and a stable model `id`; `label` is presentation text only.

The Tauri adapter remains in `app/src/lib/models/gateway.ts`. Document-specific model
selection and request construction live in `@avenos/document-ingest`.

The `input-decision` subpath owns the closed route/reply contracts used before an
input becomes a contribution, and a separate feedback contract used afterward.
Routing selects the conversation, not the source or destination of a requested
task/file change. Cross-Intent work stays in the selected conversation unless the
user separately asks to discuss it elsewhere. In the same bounded call, the model
first quotes any explicit conversation direction, then classifies that instruction
before choosing a destination. Admission rejects invented quotes and inconsistent
combinations; only grounded explicit conversation directions bypass a destination
question. Scalar decision tokens permit surrounding whitespace, but unknown fields
or values remain invalid. The optional topic label may be empty for an acknowledgement;
missing presentation text must not block a valid route. There is no language-specific
keyword bypass.
Routing never waits for sentiment classification. Feedback identifies an exact saved
assistant response and a verbatim supporting phrase. It distinguishes answer and
delivery problems from ordinary consent, task refinement and emotions about the topic;
an explicit refusal to rate remains neutral. Invalid output fails the feedback check,
not the destination decision. Persistence and manual-override rules belong to the
Intent Service, not to this model contract.

Presentation locales are canonicalized at input capture and the request boundary.
Unsupported OS locale values such as `C` and `POSIX` use `en-GB`; valid language,
script and numeric-region tags are preserved. An OS locale must not turn an otherwise
valid destination request into a routing error.
