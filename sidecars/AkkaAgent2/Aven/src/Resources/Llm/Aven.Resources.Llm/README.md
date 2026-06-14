# Aven.Resources.Llm

## Purpose

Implements the LLM resource boundary, provider-file registry, extraction pipeline, and provider adapters.

## Owns

- `LlmRequestWorkerActor`, `ProviderFileRegistryActor`, provider adapters, extraction pipeline, input preparation

## Does not own

- routing policy ownership, API composition, trace truth

## Public contracts

- LLM contracts from `Aven.Resources.Llm.Contracts` and schema registry integration

## Actor ownership / persistence

- Implements persistent LLM request/provider-file ownership.

## Dependencies

- `Aven.ActorKernel`, `Aven.Capabilities`, `Aven.Contracts`, `Aven.Resources.Llm.Contracts`, `Aven.SchemaRegistry`, `Microsoft.Extensions.Http`, `Akka.Persistence`

## Used by

- `Aven.Routing`, `Aven.Api`, tests

## Important rules

- Actor implementation owns request/provider-file durability. `LlmInputPreparer` is a pure preparer; transport concerns stay in provider adapters.
- Production actors must depend only on provider/toolkit contracts. In-memory provider behavior and provider-file test registries live under test support (`tests/Aven.Testing`) rather than this runtime project.

## Tests

- `Aven.Tests.Resources`, `Aven.Tests.Routing`, trace tests
