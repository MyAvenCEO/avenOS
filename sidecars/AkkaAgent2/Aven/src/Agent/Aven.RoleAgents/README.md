# Aven.RoleAgents

## Purpose

Implements the `RoleAgentActor` and agent-owned workflow progression over committed input and delivery-driven side effects.

## Owns

- `RoleAgentActor`, agent lifecycle transitions, committed-input handling, durable next-work facts

## Does not own

- HTTP composition, routing ownership, trace read models

## Public contracts

- public agent contracts consumed through `Aven.RoleAgents.Contracts` and delivery/resource contracts

## Actor ownership / persistence

- Implements `RoleAgentActor`; persists agent semantic events.

## Dependencies

- `Aven.RoleAgents.Contracts`, `Aven.Contracts`, `Aven.DurableDelivery`, `Aven.DurableDelivery.Contracts`, `Aven.Roles`, `Akka.Persistence`

## Used by

- `Aven.Api`, tests, and related actor implementations through contracts

## Important rules

- Keep reusable domain facts out of `Aven.Api`; agent side effects should continue to travel through delivery/resource boundaries.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.ActorKernel`, E2E coverage
