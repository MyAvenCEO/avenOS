# Aven.Resources.Artifacts.Contracts

## Purpose

Runtime-facing artifact operation contracts used by roles, gateways, API composition, and tests.

## Owns

- role/API-facing artifact operation payloads and results:
  - `ArtifactWriteOperationPayload`
  - `ArtifactWriteOperationResult`
- runtime-only artifact operation commands, events, responses, and state.

## Does not own

- blob persistence implementation
- SQLite implementation details
- HTTP composition or actor wiring
- portable toolkit artifact primitives

## Toolkit split

Portable, actor-free artifact primitives live in `Aven.Toolkit.Artifacts` and are consumed here:

- `ArtifactRef`
- `BlobRef`
- `ArtifactDescriptor` / `ArtifactRevisionDescriptor`
- `StoredBlob`
- `ArtifactQuery`
- `IArtifactStore` / `IArtifactBlobStore`

## Public contracts

- role-facing artifact handles use `ArtifactId` / `ArtifactRef`
- raw blob identities are not role-facing payload contracts
- `storageRef` is internal durable-storage metadata, not an API/role contract

## Actor ownership / persistence

- Contracts assembly only.
- No compatibility DTO families, aliases, or dual artifact models.

## Dependencies

- `Aven.Contracts`, `Aven.Events`, `Aven.Toolkit.Core`, `Aven.Toolkit.Artifacts`

## Used by

- `Aven.Resources.Artifacts`, `Aven.Resources.Runtime`, `Aven.Api`, tests

## Important rules

- Contract projects may reference toolkit contracts/primitives, but must not reference runtime implementations or Akka packages.
- Artifact queries enumerate artifact descriptors; metadata queries remain a separate metadata-resource concern.
- Prefer toolkit artifact primitives for all non-runtime-specific artifact concepts.

## Tests

- `Aven.Tests.Resources`, architecture tests
