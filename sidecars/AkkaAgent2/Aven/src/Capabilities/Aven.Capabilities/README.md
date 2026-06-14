# Aven.Capabilities

## Purpose

Implements the capability authority used to admit or reject side-effect operations.

## Owns

- capability grants, admission decisions, capability authority actor/service

## Does not own

- resource-specific product workflows, HTTP composition

## Public contracts

- contracts from `Aven.Capabilities.Contracts`

## Actor ownership / persistence

- Implements persistent capability authority behavior.

## Dependencies

- `Aven.ActorKernel`, `Aven.Capabilities.Contracts`, `Aven.Contracts`, `Aven.Serialization`, `Akka.Hosting`, `Akka.Persistence`

## Used by

- resources, `Aven.Api`, tests

## Important rules

- Keep side-effect authorization facts here rather than in ad hoc workflow code.

## Tests

- `Aven.Tests.Capabilities`, `Aven.Tests.ActorKernel`
