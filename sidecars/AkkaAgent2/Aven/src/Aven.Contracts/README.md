# Aven.Contracts

## Purpose

Repository-wide shared primitive contracts.

## Owns

- runtime-foundational envelopes, operation models, capability primitives, and bounded payload primitives
- runtime-specific identifiers and value objects that are not yet toolkit authority

## Does not own

- actor implementations, HTTP composition, persistence mechanics

## Public contracts

- shared public contracts that remain runtime-foundational
- compatibility namespace for selected core primitives now owned by `Aven.Toolkit.Core`

## Actor ownership / persistence

- No actor ownership or persistence.

## Dependencies

- `Aven.Toolkit.Core`

## Used by

- all source, test, and tool assemblies

## Important rules

- Keep this assembly foundational and dependency-light.
- Do not reintroduce duplicate runtime-independent primitive implementations that now belong to `Aven.Toolkit.Core`.
- `SchemaRef`, `OperationError`, and `OperationValue` are toolkit-owned and exposed here only through compatibility forwarding.

## Tests

- `Aven.Tests.Contracts`
