# Implementation notes: system-tree inspection slice

This iteration adds generic real/virtual system-tree inspection without changing actor execution semantics.

## Baseline check

- baseline typecheck status: pass
- baseline test status: pass
- baseline UI status: pass (tree/debug UI loaded successfully; Vite used port 5174 because 5173 was already in use)

- No repo-level pre-existing typecheck/test failures were found.

## Important boundaries

- `ActorRef` still represents real actors only.
- `TreeNodeRef` represents inspectable tree paths, including virtual namespaces, virtual collections, virtual items, and real actor aliases.
- Virtual nodes do not get mailboxes, lifecycle, supervision, retries, or independent state ownership.
- Virtual node data is exposed through `ActorDefinition.systemTree` hooks over a read-only actor-state snapshot.
- Mutating operations should still be modeled as actor messages to the owning actor. `invokeNodeOperation` is intended for bounded inspection operations unless a caller explicitly designs a safe command mapping.

## Main additions

- `src/core/tree-node-ref.ts`
- `src/introspection/system-tree-types.ts`
- `src/introspection/system-tree.ts`
- `ActorDefinition.systemTree`
- `ActorInspector.inspectTree / inspectNode / listChildren / invokeNodeOperation`
- convenience forwarding methods on `ActorSystem`
- system-tree tests for passive schema records and active worker aliases

## Aven schema registry subsystem

This iteration adds the first Aven subsystem under `/aven/system/schemas`.

- `/aven`, `/aven/system`, `/aven/system/schemas`, and `/aven/system/schemas/{schemaId}` are real actors.
- `/latest`, `/versions`, and `/versions/{version}` are virtual inspection nodes owned by each schema actor.
- Schema versions are immutable by version string; re-registering the same version with the same hash is treated as idempotent success, while a different hash is rejected.
- Latest resolution is virtual and never stored as a durable `SchemaRef.version` value.
- JSON Schema validation is wrapped in a dedicated Ajv-based service with typed validation results for normal failures.

### Cleanup updates for schema subsystem hardening

- Removed `@ts-nocheck` from the schema subsystem implementation and schema subsystem tests, and replaced the affected areas with explicit types.
- Removed hardcoded absolute local paths from the tree explorer dev launcher and Vite alias configuration by resolving paths from `import.meta.url`.
- Replaced the custom partial debug-message JSON Schema validator with the shared Ajv-backed validation service so nested objects, arrays, required fields, and additional-properties rules all follow the same behavior.
- Updated version-node `validateJson` operations to expose dynamic `inputSchema.default` / `inputSchema.examples` values derived from each registered schema instead of the prior invoice-specific placeholder.
- Updated the Svelte node details panel to prefill operation editors from operation defaults/examples and to show inline JSON parse errors before submitting invalid operation input.
- Error results for missing latest/family cases now avoid durable `{ version: "latest" }` schema references; they only include the schema id, or schema id plus a concrete version when one actually exists.

## Known limitations

- Schema version ordering currently uses simple dot-separated numeric/string comparison intended for demo semver-like values such as `1.0.0` and `1.1.0`.
- Demo seeding is intentionally local to the tree explorer backend and is restored on reset.
- Example generation for dynamic `validateJson` inputs is schema-driven but intentionally simple; when a schema does not provide defaults/examples/const/enum hints, fallback placeholder values are synthesized from the declared JSON Schema types.

## Aven artifact subsystem

This iteration adds immutable content-addressed blob storage under `/aven/system/artifacts`.

- `/aven/system/artifacts` is a real actor rooted under the Aven system actor.
- `/blobs`, `/blobs/sha256`, `/blobs/sha256/{first2}`, and `/blobs/sha256/{first2}/{hash}` are virtual inspection nodes owned by that actor.
- Blob identity is SHA-256 of bytes only; duplicate bytes dedupe even when MIME differs.
- The in-memory implementation stores descriptors separately from bytes and does not add metadata databases, LLM behavior, runtime execution, filesystem persistence, or full artifact readers.
- Supported artifact actor write operations are `putText`, `putJson`, and `putBase64`; read/inspection operations are `exists`, `getDescriptor`, and `readTextPreview`.
- Expected failure cases are returned as typed results with categories `artifactMissing`, `invalidRequest`, `unsupportedMime`, and `readTooLarge`.

## Artifact readers subsystem

This iteration adds bounded typed readers under `/aven/system/artifact-readers` without changing artifact ownership.

- `/aven/system/artifact-readers`, `/bytes`, `/text`, and `/json` are all real actors.
- Readers do not bypass `/aven/system/artifacts`; they request descriptors and bounded byte ranges through internal artifact messages.
- The artifact actor now supports `artifactGetDescriptorRequest` / `artifactGetDescriptorCompleted` and `artifactReadBytesRequest` / `artifactReadBytesCompleted` in addition to the existing artifact existence request.
- Byte reads are capped at `64 KiB`, reject negative offsets/lengths, and return JSON-safe base64 payloads.
- The bytes reader exposes `readBytes`, the text reader exposes `readTextPreview` and `readTextRange`, and the JSON reader exposes `parseJson`.
- Text readers accept `text/*`, `application/json`, and `*+json`; the JSON reader accepts only JSON MIME types.
- Typed reader failures now include `artifactMissing`, `invalidRequest`, `rangeOutOfBounds`, `readTooLarge`, `unsupportedMime`, and `outputInvalid`.
- The registry exposes `listReaders` and `listCompatibleReaders` so the UI can route blob refs through safe access modes rather than raw artifact paths.

## Baseline and final checks for this iteration

- Initial command attempts failed because the local environment did not yet have installed workspace dependencies and the shell PATH did not expose the expected Node/npm toolchain.
- After installing dependencies with `bun install`, baseline `typecheck`, `build`, and `test` all passed without code changes required to fix pre-existing product failures.
- Final `typecheck`, `build`, and `test` all pass after the artifact subsystem changes.

## Metadata subsystem baseline note

- Before metadata changes, local baseline command attempts in this sandbox still failed because workspace executables such as `tsc` and `vitest` were not available from installed dependencies in the command environment.
- After dependencies are available, rerun `typecheck`, `build`, and `test` to confirm baseline/final status for the metadata slice.

## Tree explorer node detail UX redesign

- Split the previous all-in-one `NodeDetails.svelte` into focused components for the header, dashboard, structure, actions, actor state, mailbox, events, and reusable JSON rendering.
- Reworked the dashboard into an at-a-glance command center with status badges, metric cards, compact summary/last-result panels, and suggested next-action buttons that jump to the relevant tab.
- Moved all operation and debug-message execution into a dedicated two-pane `Actions` tab, including alias-aware debug message targeting, editor prefills from defaults/examples, inline JSON parse errors, and full validation payload rendering for API-side validation failures.
- Replaced table cell stringification with expandable JSON previews so nested values no longer render as `[object Object]`, and added copy affordances for important identifiers such as paths, actor ids, owner ids, schema/blob refs, record ids, and envelope ids.
- Added tab availability/default-tab logic so virtual collections default to Structure, actor-less virtual nodes do not surface empty actor tabs, and action-oriented workflows return to Actions after running commands.

## Aven LLM mock dispatcher subsystem

- Replaced the old toy `/llm` root with a real Aven-owned tree under `/aven/system/llms/mock/echo/default`.
- Added bounded dispatcher state with `maxParallel`, `maxQueue`, `queued`, `running`, `completed`, and virtual `/requests` aliases for request workers.
- Added deterministic mock worker behavior: text requests echo the latest user text; schema-backed requests validate the latest JSON input part through `/aven/system/schemas` and return typed `schemaInvalid`, `schemaNotFound`, or `outputInvalid` results.
- Kept this slice intentionally local-only: no external providers, tools, agents, memory, or runtime execution were added.

## Baseline and final checks for LLM iteration

- Baseline `typecheck`, `build`, and `test` passed after invoking npm/bun with an explicit PATH that included the local Node and Bun installations in this sandbox.
- Final validation should re-run the same commands after the LLM subsystem changes.

## LLM lifecycle/tree follow-up

- In this sandbox, current baseline command attempts fail before product code runs because `npm` and `node` are unavailable on PATH, and Bun is unavailable for `bun test`.
- The LLM dispatcher now treats request workers as temporary actors: they stop with `StopReasonType.Completed` after reporting completion to the parent dispatcher.
- `/requests/{id}` stays a `realActorAlias` only while a request is active; once completed, it becomes a dispatcher-owned `virtualItem` backed by `dispatcher.completed`.
- Completed request virtual items still expose `getResult`, but no longer expose actor debug-message actions because they no longer carry `actorId`/`actorKind`.
- The tree explorer UI now labels real actor `status` as lifecycle-oriented so long-lived actors showing `running` do not imply active job execution.

## LM Studio provider slice

- Added a backend-only LM Studio provider under `/aven/system/llms/lmstudio`; the browser does not call LM Studio directly.
- Added `lmstudio-client.ts` with typed `/v1/models` and `/v1/chat/completions` access, trailing-slash normalization, required timeout handling, and typed transport/HTTP/response failures.
- Added real actor kinds for `LmStudioProvider`, `LmStudioModel`, `LmStudioDispatcher`, and `LmStudioRequestWorker` alongside the existing mock provider.
- `refreshModels` now discovers visible LM Studio models, stores original model ids, and spawns safe `model~{slug}` actor paths while preserving the human-readable model id in actor presentation/state.
- LM Studio dispatchers reuse the bounded queue/running/completed request lifecycle and keep completed requests as virtual history nodes.
- Request input conversion currently supports text and JSON parts; artifact parts are rejected with typed `unsupportedInputPart` results.
- Structured-output mode instructs LM Studio to return JSON only, parses the assistant content, validates it through `/aven/system/schemas`, and returns typed `outputInvalid`, `schemaInvalid`, or `schemaNotFound` results as needed.
- The deterministic mock provider remains intact for local tests and stable behavior.

## Housekeeping regression fixes

- Fixed the tree explorer housekeeping regressions without adding `HumanActor` yet.
- `actor-host.ts` now imports `BuildLlmSubsystemOptions` directly from `llm-subsystem.ts` instead of expecting it from `aven-spine.ts`.
- Artifact reader registry, bytes reader, text reader, and JSON reader now stamp new pending entries with `deadlineAt` and explicitly branch cleanup messages before handling completion messages.
- Added cleanup-focused artifact subsystem coverage verifying expired pending requests are removed, fresh pending requests remain, and cleanup results report `cleanedUpCount` plus `remainingPendingCount`.

## Validation note for this sandbox

- In this sandbox session, `node`, `npm`, and `bun` were not available on `PATH`, so I could not re-run the requested `typecheck`, `build`, and `test` commands locally after making the fixes.

## HumanActor iteration baseline and current validation status

- Baseline before starting `HumanActor`: repo `typecheck` passed and repo `build` passed after exporting a PATH that included the local Node and Bun installations.
- Baseline repo `test` did **not** fully pass before HumanActor work due to pre-existing tree-explorer failures unrelated to this slice:
  - `llm subsystem > enforces queue bounds and starts queued requests after completion`
  - `artifact actor subsystem > cleans up expired pending registry, byte, text, and json reader requests while preserving non-expired entries`
- After the HumanActor changes in this iteration, `typecheck` still passes and `build` still passes.
- Current test status is not yet clean because the same two pre-existing failures remain, and HumanActor coverage is still being brought to green.

## System-tree count and Human communication stabilization

- Baseline checks for this stabilization pass:
  - `npm --workspace typed-actors run typecheck`: pass
  - `npm --workspace typed-actors run build`: pass
  - `npm --workspace typed-actors run test`: pass
  - `npm --prefix apps/tree-explorer run typecheck`: pass
  - `npm --prefix apps/tree-explorer run build`: pass
  - `bun test`: had pre-existing failures unrelated to this stabilization slice in this environment:
    - `artifact actor subsystem > cleans up expired pending registry, byte, text, and json reader requests while preserving non-expired entries`
    - `event loop > scheduler wake does not exceed configured concurrency and stop clears timers`
    - `event loop > scheduler reports callback errors instead of creating unhandled rejections`
    - `no magic strings > does not compare raw protocol literals in runtime and persistence sources`
    - `fix pass regressions > idle scheduler uses backoff instead of tight polling`

- Stabilization changes completed in this pass:
  - Extracted dashboard metric calculation into `frontend/src/components/node-dashboard-metrics.ts` with explicit count semantics comments.
  - Renamed dashboard labels to distinguish tree children, runtime actor children, mailbox completed, mailbox pending, and domain-specific counts.
  - Added pure helper tests for dashboard metrics and communication path resolution.
  - Extracted canonical Human communication path helpers into `frontend/src/lib/communication-paths.ts` and updated UI code to always generate bucketed canonical paths.
  - Added backend regressions covering read-only Human list operations and create/list/inspect/complete tree transitions.
  - Fixed Human list results so they serialize as JSON-safe cloned communication records instead of faulting actor state updates.
  - Made demo-system LM Studio startup deterministic for non-LLM tests by supplying a default no-op LM Studio client when none is provided.

- Final validation after these changes:
  - `npm --workspace typed-actors run typecheck`: pass
  - `npm --workspace typed-actors run build`: pass
  - `npm --workspace typed-actors run test`: pass
  - `npm --prefix apps/tree-explorer run typecheck`: pass
  - `npm --prefix apps/tree-explorer run build`: pass
  - Focused stabilization tests passed:
    - `apps/tree-explorer/backend/human-subsystem.test.ts`
    - `apps/tree-explorer/frontend/src/components/node-dashboard-metrics.test.ts`
    - `apps/tree-explorer/frontend/src/lib/communication-paths.test.ts`
  - Full `bun test` still reports only the same pre-existing unrelated failures listed in the baseline note above.

## LM Studio model listing follow-up

- A follow-up regression was introduced by the stabilization pass: `createDemoSystem()` always injected the default no-op LM Studio client, which prevented real LM Studio model discovery when callers supplied only `lmStudioBaseUrl`.
- Fixed by only injecting the default no-op client when no LM Studio options are provided at all, and by wiring `LMSTUDIO_BASE_URL` / `LMSTUDIO_TIMEOUT_MS` through `backend/dev.ts` into `ActorHost`.
- Verified against `http://192.168.178.28:8001/v1/models` in this environment: the provider summary now reports `modelCount: 21` and `/aven/system/llms/lmstudio` exposes the expected model child nodes.

## Intent v0

- Added real actor kinds `Intents` and `Intent` and mounted `/aven/intents` beside `/aven/system` under the Aven root.
- Added deterministic intent domain types in `backend/intent-domain.ts` for `IntentStatus`, `IntentRoutingCard`, and `IntentTimelineEvent`.
- Implemented `/aven/intents` as a router actor that can `createIntent`, `listIntents`, `getRoutingCard`, and deterministically forward `humanReplyReceived` messages by `intentId + openQuestionId`.
- Implemented `/aven/intents/{intentId}` as a real intent actor that records lifecycle timeline events, creates exactly one human question in v0, stores human answers, and completes without any model calls.
- Extended `HumanActor` reply routing so answered communications with `routingHint.intentId` and `routingHint.openQuestionId` are routed back through `/aven/intents` instead of any LLM path.
- Added virtual intent inspection nodes for `/timeline`, `/timeline/{eventId}`, and `/jobs` (empty in v0), plus operation inventory/UI wiring for `createIntent`, `getIntent`, `continueIntent`, and `cancelIntent`.
- Added focused tests covering router creation, human question creation, deterministic reply routing, completion, timeline inspection, stale hint rejection, unknown intent rejection, and inventory exposure.

## Intent v0 validation

- Baseline commands in this environment:
  - `npm run typecheck`: pass
  - `npm run build`: pass
  - `npm test`: fails only because of pre-existing unrelated `bun test` failures in the repo
  - `bun test`: pre-existing unrelated failures remained:
    - `artifact actor subsystem > cleans up expired pending registry, byte, text, and json reader requests while preserving non-expired entries`
    - `event loop > scheduler wake does not exceed configured concurrency and stop clears timers`
    - `event loop > scheduler reports callback errors instead of creating unhandled rejections`
    - `no magic strings > does not compare raw protocol literals in runtime and persistence sources`
    - `fix pass regressions > idle scheduler uses backoff instead of tight polling`
- Focused validation after Intent v0 changes:
  - `bun test apps/tree-explorer/backend/intent-subsystem.test.ts`: pass
  - `bun test apps/tree-explorer/backend/operation-inventory.test.ts`: pass
  - `npm run typecheck`: pass
  - `npm run build`: pass
- Final full-suite status after Intent v0 changes is unchanged relative to the pre-existing repo issues above:
  - `npm test`: still fails only due to the same unrelated `bun test` failures
  - `bun test`: still fails only due to the same unrelated pre-existing failures listed above

## LLM OpenAI-compatible base URL semantics

- Updated the LM Studio/OpenAI-compatible client to treat `baseUrl` as the OpenAI-compatible API base, typically ending in `/v1`.
- Model discovery now uses `GET {baseUrl}/models` and chat completion now uses `POST {baseUrl}/chat/completions`.
- Trailing slashes are normalized so both `.../v1` and `.../v1/` work consistently.
- Added focused backend coverage for both model discovery and chat completion URL construction.

## LLM provider config v1: config, capabilities, and thinking metadata

- Added `backend/llm-provider-config.ts`, `backend/llm-domain.ts`, and `config/llm-providers.example.json` to move the tree explorer LLM subsystem to JSON-configured OpenAI-compatible providers.
- Provider config loading now prefers `AVEN_LLM_CONFIG`, otherwise `apps/tree-explorer/config/llm-providers.local.json`, otherwise returns an empty configured-provider list plus a warning; the local file is gitignored.
- Added provider/model capability metadata including input modalities, artifact-input mode, and thinking support, and surfaced it through dispatcher `describeCapabilities` plus tree summaries.
- Added dispatcher `validateLlmInput` and submit-time prevalidation so unsupported thinking and unsupported artifact inputs fail with typed `modelCapability` errors before any worker is spawned.
- Added config-driven provider discovery for `modelsEndpoint` and `manual`, plus bearer-env auth wiring that resolves env vars only when constructing real HTTP clients.
- Kept legacy LM Studio actor kinds for now, but generalized their state, titles, and tree paths so providers appear only through config at `/aven/system/llms/{providerId}` and models live under `/model~{slug}/{configId}`.
- For backward compatibility with existing runtime/tests, the subsystem falls back to a legacy single `lmstudio` provider config when no provider JSON is present and legacy LM Studio options are supplied.

## Validation status for provider-config slice

- Baseline before this slice in this environment:
  - `npm --workspace typed-actors run typecheck`: pass
  - `npm --workspace typed-actors run build`: pass
  - `npm --workspace typed-actors run test`: pass
  - `npm --prefix apps/tree-explorer run typecheck`: pass
  - `npm --prefix apps/tree-explorer run build`: pass
  - `bun test`: had pre-existing unrelated failures in this environment, including artifact-reader cleanup and several typed-actors Bun-specific test failures.
- Final validation after these changes:
  - `npm --workspace typed-actors run typecheck`: pass
  - `npm --workspace typed-actors run build`: pass
  - `npm --workspace typed-actors run test`: pass
  - `npm --prefix apps/tree-explorer run typecheck`: pass
  - `npm --prefix apps/tree-explorer run build`: pass
  - `bun test`: LLM/provider-config coverage now passes; full-suite failures remain only in the same pre-existing unrelated areas:
    - `artifact actor subsystem > cleans up expired pending registry, byte, text, and json reader requests while preserving non-expired entries`
    - `event loop > scheduler wake does not exceed configured concurrency and stop clears timers`
    - `event loop > scheduler reports callback errors instead of creating unhandled rejections`
    - `no magic strings > does not compare raw protocol literals in runtime and persistence sources`
    - `fix pass regressions > idle scheduler uses backoff instead of tight polling`

## LLM manual-config + artifact/API leakage cleanup

- Removed provider auto-discovery and legacy LM Studio fallback behavior; LLM provider/model actors now come only from explicit `llmConfig.providers[].models[]` or loaded config JSON.
- Removed legacy shortcut options (`lmStudioClient`, `lmStudioBaseUrl`, `lmStudioTimeoutMs`) from the subsystem path and updated demo wiring to use `openAiCompatibleClientsByProviderId` plus explicit config.
- Simplified provider operations to `listModels` only, removed `refreshModels`, and stopped default/demo code from hardcoding `/aven/system/llms/lmstudio` startup behavior.
- Removed raw artifact bytes from `ArtifactActorState`; byte ownership now stays inside `ArtifactStorage`, and artifact/tree preview reads resolve bytes through storage reads.
- Sanitized `/api/node/operation` and `/api/actor/send-message` responses so they return `result`/`runResult` plus refreshed `node`, without leaking full `actorDetail`, `nodeDetail`, or raw actor state through mutation endpoints.
- Updated config examples, frontend response types, and focused backend tests to match the sanitized/manual-only behavior.

## Validation status for cleanup slice

- Baseline in this environment before cleanup changes:
  - `npm --workspace typed-actors run typecheck`: pass
  - `npm --workspace typed-actors run build`: pass
  - `npm --workspace typed-actors run test`: pass
  - `npm --prefix apps/tree-explorer run typecheck`: pass
  - `npm --prefix apps/tree-explorer run build`: pass
  - `bun test`: failed in pre-existing unrelated areas, plus the artifact pending-cleanup test noted by the user/task.
- Current/focused validation during cleanup:
  - `npm --prefix apps/tree-explorer run typecheck`: pass
  - Focused `bun test` coverage for `llm-subsystem`, `llm-provider-config`, `operation-inventory`, and most `artifact-subsystem` assertions now passes.
  - One artifact cleanup regression test is still being adjusted around pending-entry timing semantics in this environment before final full-suite validation can be recorded.
