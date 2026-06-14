# Aven.Resources.Artifacts

## Purpose

Implements runtime artifact persistence/orchestration around the toolkit-owned artifact primitives.

## Owns

- `SqliteArtifactStore` for runtime artifact/revision metadata persistence
- runtime composition that wires toolkit artifact storage/layout helpers into production flows
- runtime-specific artifact operation handling that remains outside the portable toolkit surface

## Does not own

- HTTP composition, capability policy ownership, metadata ownership

## Public contracts

- runtime-facing contracts from `Aven.Resources.Artifacts.Contracts`
- portable artifact primitives from `Aven.Toolkit.Artifacts`

## Actor ownership / persistence

- Active runtime path uses SQLite metadata plus durable blob storage.
- Artifact bytes are addressed by `BlobRef`; app workflows exchange `ArtifactRef`.

## Dependencies

- `Aven.ActorKernel`, `Aven.Capabilities`, `Aven.Contracts`, `Aven.Resources.Artifacts.Contracts`, `Akka.Persistence`

## Used by

- `Aven.Api`, tests

## Important rules

- Portable artifact truth no longer belongs here; `ArtifactRef`, `BlobRef`, blob layout, and file-system blob storage are owned by `Aven.Toolkit.Artifacts`.
- This project should stay focused on runtime persistence/orchestration and consume toolkit primitives rather than duplicating them.
- Role-facing payloads must not carry `BlobRef` or internal `storageRef` values.
- No compatibility layer with legacy artifact create/append DTO families.

## Tests

- `Aven.Tests.Resources`, `Aven.Tests.ActorKernel`
