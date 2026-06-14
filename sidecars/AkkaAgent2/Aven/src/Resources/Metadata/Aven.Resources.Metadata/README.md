# Aven.Resources.Metadata

## Purpose

Implements immutable schema-validated metadata storage and query behavior.

## Owns

- `MetadataStoreActor`
- metadata records and query contracts
- durable metadata facts

## Does not own

- HTTP composition
- schema registry ownership
- product workflow orchestration
- resource gateway admission or durable-delivery inbox state

## Public contracts

- metadata contracts from `Aven.Resources.Metadata.Contracts`

## Actor ownership / persistence

- `MetadataStoreActor` owns durable metadata writes and recovered metadata state.
- Gateway-mediated metadata operations are owned by `Aven.Resources.Runtime`.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.Resources.Metadata.Contracts`, `Akka.Persistence`

## Used by

- `Aven.Resources.Runtime`, `Aven.Api`, tests

## Important rules

- Durable truth belongs to `MetadataStoreActor`.
- Gateway actors must not query or mutate metadata inline.
- Test-only metadata clients and in-memory metadata helpers live under test support, not under `src`.

## Tests

- `Aven.Tests.Metadata`, `Aven.Tests.E2E`, architecture tests
