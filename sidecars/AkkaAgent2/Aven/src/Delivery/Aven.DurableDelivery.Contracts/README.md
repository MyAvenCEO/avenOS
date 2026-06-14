# Aven.DurableDelivery.Contracts

## Purpose

Public contracts for durable actor-owned delivery.

## Owns

- delivery commands, events, launch specs, policies, offers, responses, and state

## Does not own

- delivery implementation logic, Akka integration

## Public contracts

- delivery protocol surface used by senders/recipients

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.Events`

## Used by

- `Aven.DurableDelivery`, senders, schedulers, API, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Delivery`, architecture tests
