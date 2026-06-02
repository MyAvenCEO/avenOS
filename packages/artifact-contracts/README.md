# artifact-contracts

Public artifact mailbox and value contracts for the tree-explorer backend.

## Purpose

This package defines the public request/response and shared value shapes for the
artifact subsystem.

Examples:

- `BlobRef`
- `BlobDescriptor`
- `ArtifactExistsRequest`
- `ArtifactGetDescriptorCompleted`

## Boundary

This package should contain only public contracts used across subsystem boundaries.

It should **not** contain:

- storage implementations
- actor behavior
- tree presentation
- runtime wiring

## Intended consumers

- API/backend adapters
- intent orchestration
- metadata subsystem
- LLM subsystem

## Rule of thumb

If another subsystem only needs artifact value types or public mailbox messages, it
should import this package instead of `artifact-subsystem.ts`.