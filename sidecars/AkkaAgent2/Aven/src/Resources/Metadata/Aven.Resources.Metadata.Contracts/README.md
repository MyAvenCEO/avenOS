# Aven.Resources.Metadata.Contracts

## Purpose

Public contracts for immutable schema-gated metadata operations.

## Owns

- metadata create/query commands, events, result DTOs, records, and validation models

## Does not own

- metadata implementation logic, Akka integration

## Public contracts

- metadata protocol and query contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.Resources.Metadata`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Metadata`, `Aven.Tests.E2E`, architecture tests
