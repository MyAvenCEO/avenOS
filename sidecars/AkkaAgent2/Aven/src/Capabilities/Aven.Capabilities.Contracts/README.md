# Aven.Capabilities.Contracts

## Purpose

Public contracts for capability grant and admission semantics.

## Owns

- grant/admission commands, events, request/response DTOs

## Does not own

- capability implementation logic, Akka integration

## Public contracts

- capability protocol DTOs and events

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.Capabilities`, resources, API, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Capabilities`, architecture tests
