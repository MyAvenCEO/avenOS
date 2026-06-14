# Aven.SchemaRegistry.Contracts

## Purpose

Public contracts for schema registration, lookup, family/version queries, and validation responses.

## Owns

- schema commands, events, registered-schema DTOs, and validation/query responses

## Does not own

- schema implementation logic, Akka integration

## Public contracts

- schema registry protocol contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.SchemaRegistry`, `Aven.Resources.*`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.SchemaRegistry`, architecture tests
