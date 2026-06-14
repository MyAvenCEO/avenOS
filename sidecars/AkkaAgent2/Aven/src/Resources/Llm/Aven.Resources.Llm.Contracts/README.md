# Aven.Resources.Llm.Contracts

## Purpose

Public runtime contracts for LLM request/extraction workflows, provider abstractions, runtime events,
and provider-facing orchestration DTOs.

## Owns

- LLM commands, events, provider interfaces, runtime request/response models, provider-file
  descriptors, and runtime orchestration DTOs

## Does not own

- provider implementation logic, Akka integration, or the provider-independent LLM input-block model

## Toolkit authority boundary

`Aven.Toolkit.Llm` is now authoritative for the runtime-independent portable block/value-object seam.

Toolkit-owned provider-independent input-block types used by these runtime contracts:

- `LlmInputBlock`
- `LlmBlockKind`
- `TextInputBlock`
- `JsonInputBlock`
- `ToolDefinitionInputBlock`
- `ToolResultInputBlock`
- `ArtifactInputBlock`
- `ProviderFileInputBlock`
- `LlmInputBlockSummary`

This assembly intentionally still owns runtime workflow contracts such as:

- `LlmRequest`
- `LlmExtractionRequest`
- request/reply/event DTOs tied to `OperationKey`, `CorrelationId`, actor routing, and runtime
  orchestration
- provider abstractions and provider-file/result descriptors that are part of the runtime resource
  seam

Important corrective-pass seam rule:

- production request DTOs must not expose `InMemoryLlmResponsePlan` or `InMemoryLlmScenarioKind`
- in-memory scenario behavior is configured directly on `InMemoryLlmProvider`, not carried through
  `LlmRequest` or `LlmExtractionRequest`

## Public contracts

- LLM protocol contracts and provider abstractions

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`, `Aven.Toolkit.Llm`

## Used by

- `Aven.Resources.Llm`, `Aven.Routing`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.
- If a provider-independent LLM block/value type already exists in `Aven.Toolkit.Llm`, this
  contracts assembly must consume that toolkit type rather than re-declare a parallel runtime copy.

## Tests

- `Aven.Tests.Resources`, `Aven.Tests.Routing`, architecture tests
