# Aven.Submission

## Purpose

Implements the product submission rail from idempotent command admission into routing.

## Owns

- `MessageSubmissionActor`, actor-backed `MessageSubmissionClient`, routing delivery adapter actor, accepted-command facts

## Does not own

- HTTP endpoint composition, long-lived downstream business facts

## Public contracts

- submission contracts plus routing and durable delivery contracts

## Actor ownership / persistence

- Implements persistent submission behavior.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.DurableDelivery`, `Aven.DurableDelivery.Contracts`, `Aven.Submission.Contracts`, `Aven.Routing`, `Aven.Serialization`, `Akka.Hosting`

## Used by

- `Aven.Api`, tests

## Important rules

- Keep this assembly as the actor-backed submission boundary; do not reintroduce `/api/inspection`-style alternate read paths here.

## Tests

- `Aven.Tests.Submission`, `Aven.Tests.E2E`, architecture tests
