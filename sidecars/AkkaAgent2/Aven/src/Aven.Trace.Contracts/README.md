# Aven.Trace.Contracts

## Purpose

Public contracts for trace query DTOs, projection health, and flush/health commands.

## Owns

- trace query models, subject/detail/timeline DTOs, health/flush contracts

## Does not own

- trace implementation details, API runtime composition

## Public contracts

- trace query/read-side contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- none

## Used by

- `Aven.Trace`, `Aven.Api`, `Aven.Debug`, tests

## Important rules

- Messages/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Trace`, E2E and architecture tests
