# Aven.WorkIntake.Contracts

## Purpose

Public contracts for per-agent intake offers, claim/commit decisions, and inspection state.

## Owns

- offer/claim/commit commands, events, response models, inspection/state DTOs

## Does not own

- intake implementation logic, Akka integration, API/runtime composition

## Public contracts

- intake messages, semantic events, and state views

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.DurableDelivery.Contracts`, `Aven.Events`

## Used by

- `Aven.WorkIntake`, `Aven.Routing`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.Routing`, architecture tests
