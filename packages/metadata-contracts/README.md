# metadata-contracts

Public metadata mailbox and value contracts for the tree-explorer backend.

## Purpose

This package defines the shared value types and public mailbox contracts for the
metadata subsystem.

Examples:

- `MetadataSubject`
- `MetadataRecord`
- `CreateMetadataRecordMessage`
- `MetadataQueryRecordsInput`

## Boundary

This package should contain only public contracts used across subsystem boundaries.

It should **not** contain:

- actor behavior
- store implementation
- query execution logic
- runtime wiring

## Intended consumers

- metadata subsystem implementation
- intent orchestration
- API/backend adapters
- future package-level integrations

## Rule of thumb

If another subsystem needs to talk to metadata or share metadata value shapes, it
should import this package instead of `metadata-subsystem.ts` or `intent-domain.ts`.