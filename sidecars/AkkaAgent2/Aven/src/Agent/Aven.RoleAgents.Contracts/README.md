# Aven.RoleAgents.Contracts

## Purpose

Public contracts for agent lifecycle, committed input handling, replies, and state views.

## Owns

- agent messages, semantic events, DTOs, ids, responses, and state views

## Does not own

- agent implementation logic, Akka integration, composition/runtime code

## Public contracts

- commands, events, responses, and state records used by `Aven.RoleAgents` consumers

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.RoleAgents`, `Aven.WorkIntake`, `Aven.Api`, tests

## Important rules

- Must contain messages/events/views/ids only; must not reference implementation assemblies or Akka packages.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.ActorKernel`, E2E suites indirectly
