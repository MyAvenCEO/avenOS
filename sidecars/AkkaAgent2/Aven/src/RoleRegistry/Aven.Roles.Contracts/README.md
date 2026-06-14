# Aven.Roles.Contracts

## Purpose

Public contracts for the role-agent registry authority.

## Owns

- registry commands, events, role profile DTOs

## Does not own

- registry actor implementation, Akka integration, runtime composition

## Public contracts

- role-agent registry request/response and profile contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.RoleAgents.Registry`, `Aven.Routing`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.Routing`, architecture tests
