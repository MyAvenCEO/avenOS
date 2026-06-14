# Aven.Events

## Purpose

Shared semantic event contracts and envelopes.

## Owns

- `IAvenEvent`, event envelopes, event metadata

## Does not own

- business workflows, actor implementations

## Public contracts

- cross-assembly event contracts

## Actor ownership / persistence

- No actor ownership or persistence logic.

## Dependencies

- `Aven.Contracts`

## Used by

- any event-producing or event-consuming assembly

## Important rules

- Keep event contracts semantic and implementation-neutral.

## Tests

- `Aven.Tests.ActorKernel`, `Aven.Tests.Trace`
