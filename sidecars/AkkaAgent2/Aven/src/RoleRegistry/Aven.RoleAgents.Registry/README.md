# Aven.RoleAgents.Registry

## Purpose

Implements the persistent role-agent registry authority and a thin client wrapper for registry queries/updates.

## Owns

- `RoleAgentRegistryActor`, durable registry profile registrations

## Does not own

- routing decisions, HTTP composition, role workflow ownership

## Public contracts

- role-agent registry contracts from `Aven.Roles.Contracts`

## Actor ownership / persistence

- Implements the registry actor and persists role-agent profile registration events.

## Dependencies

- `Aven.Roles.Contracts`, `Aven.ActorKernel`, `Akka.Persistence`

## Used by

- `Aven.Routing`, `Aven.Api`, tests

## Important rules

- Keep the client wrapper thin; durable truth belongs to the actor.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.Routing`, architecture tests
