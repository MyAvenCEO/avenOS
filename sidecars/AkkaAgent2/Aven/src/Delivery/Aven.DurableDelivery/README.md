# Aven.DurableDelivery

## Purpose

Implements actor-owned durable delivery.

## Owns

- `DurableDeliveryActor`, `DurableDeliveryFactory`, delivery attempt and terminal facts

## Does not own

- business completion semantics, API composition, routing/intake/agent ownership

## Public contracts

- delivery contracts from `Aven.DurableDelivery.Contracts`

## Actor ownership / persistence

- Implements `DurableDeliveryActor` and persists delivery semantic events.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.DurableDelivery.Contracts`, `Aven.Serialization`, `Akka.Persistence`

## Used by

- senders such as ingress, intake, agent, scheduling, API runtime, and tests

## Important rules

- `DurableDeliveryFactory` is the only production construction rail for `DurableDeliveryActor`. Do not construct `DurableDeliveryActor` outside this assembly.

## Tests

- `Aven.Tests.Delivery`, `Aven.Tests.ActorKernel`, many integration suites
