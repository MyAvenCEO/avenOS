# Aven.Scheduling.Contracts

## Purpose

Public contracts for schedule registration, due-checking, schedule receipts, and schedule state views.

## Owns

- schedule commands, events, models, responses, and state DTOs

## Does not own

- scheduling implementation logic, Akka integration

## Public contracts

- scheduling protocol contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.DurableDelivery.Contracts`, `Aven.Events`

## Used by

- `Aven.Scheduling`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Scheduling`, E2E and architecture tests
