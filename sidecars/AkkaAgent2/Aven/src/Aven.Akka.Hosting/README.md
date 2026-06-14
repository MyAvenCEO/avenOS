# Aven.Akka.Hosting

## Purpose

Akka hosting extensions and local actor-address registry helpers used by runtime composition and tests.

## Owns

- hosting extension methods, in-process actor address registry

## Does not own

- product workflows, durable product facts

## Public contracts

- hosting helpers and registry abstractions for actor-system composition

## Actor ownership / persistence

- No persistent actors or product truth.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.Serialization`, `Akka.Hosting`

## Used by

- `Aven.Api`, hosting tests, other composition code

## Important rules

- Keep this assembly infrastructure-only.

## Tests

- `Aven.Tests.Hosting`
