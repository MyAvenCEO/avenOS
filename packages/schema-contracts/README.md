# schema-contracts

Shared schema contracts for the tree-explorer backend.

## Purpose

This package contains the public schema-facing types that other packages may import
without depending on schema implementation modules.

Examples:

- `SchemaRef`
- `RegisteredSchemaVersion`
- `SchemaValidationResult`

## Boundary

This package should contain **contracts only**:

- value objects
- result types
- message-adjacent schema types used across package boundaries

It should **not** contain:

- actor implementations
- runtime wiring
- storage logic
- app-specific bootstrapping

## Intended consumers

- schema implementation modules
- intent orchestration
- metadata and LLM integrations
- app/runtime composition code

## Notes

If a type can be shared safely across packages without importing schema behavior,
it belongs here.