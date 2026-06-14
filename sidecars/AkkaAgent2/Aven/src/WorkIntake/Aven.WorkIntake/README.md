# Aven.WorkIntake

## Purpose

Implements the intake authority that evaluates offers and commits accepted work to agents.

## Owns

- `WorkOfferActor`, offer lifecycle, claim/commit facts, and the thin actor client used to talk to that boundary

## Does not own

- agent core ownership, HTTP composition, global routing truth

## Public contracts

- contracts consumed from `Aven.WorkIntake.Contracts`, `Aven.RoleAgents.Contracts`, and delivery contracts

## Actor ownership / persistence

- Implements `WorkOfferActor`; persists intake offer/commit events.

## Dependencies

- `Aven.RoleAgents.Contracts`, `Aven.WorkIntake.Contracts`, `Aven.ActorKernel`, `Aven.Contracts`, `Aven.DurableDelivery`, `Aven.DurableDelivery.Contracts`, `Aven.Roles`, `Akka.Hosting`, `Akka.Persistence`

## Used by

- `Aven.Routing`, `Aven.Api`, tests

## Important rules

- `WorkOfferActor` intentionally owns many concurrent offers per agent and does not use `Become()` for offer lifecycle management.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.Routing`, architecture tests
