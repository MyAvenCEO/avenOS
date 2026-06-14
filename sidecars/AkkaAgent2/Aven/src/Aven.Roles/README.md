# Aven.Roles

## Purpose

Role catalog, role workflow policy, and role-specific plan/state models shared by agent/runtime code.

## Owns

- role registrations, role input/output contracts, role workflow computation models

## Does not own

- persistent actor lifecycle, HTTP composition, durable trace truth

## Public contracts

- role models and workflow computation contracts

## Actor ownership / persistence

- No persistent actors or Akka references.

## Dependencies

- `Aven.Contracts`

## Used by

- `Aven.RoleAgents`, `Aven.WorkIntake`, `Aven.Api`, tests

## Important rules

- This assembly provides role policy and models, not actor ownership.

## Tests

- `Aven.Tests.RoleAgents`, `Aven.Tests.E2E` indirectly
