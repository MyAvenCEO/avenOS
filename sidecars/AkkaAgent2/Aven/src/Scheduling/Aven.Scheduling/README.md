# Aven.Scheduling

## Purpose

Implements durable scheduling and due-driven delivery initiation.

## Owns

- `ScheduledWorkActor`, schedule occurrence facts, scheduled delivery request/receipt facts

## Does not own

- role workflow logic, HTTP composition, downstream business fact ownership

## Public contracts

- scheduling contracts plus delivery contracts

## Actor ownership / persistence

- Implements persistent schedule ownership.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.DurableDelivery`, `Aven.DurableDelivery.Contracts`, `Aven.Scheduling.Contracts`, `Akka.Persistence`

## Used by

- `Aven.Api`, tests

## Important rules

- Schedules should trigger actor-owned delivery work, not host-owned shortcuts.

## Tests

- `Aven.Tests.Scheduling`, `Aven.Tests.E2E`, architecture tests
