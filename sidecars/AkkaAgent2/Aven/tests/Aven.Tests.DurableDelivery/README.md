# Aven.Tests.Delivery

## What this suite proves

- Proves durable delivery attempt, retry, quarantine, dedupe, and recovery semantics.

## Suite type

- actor, recovery

## Intentional production references

- `Aven.DurableDelivery`, `Aven.ActorKernel`, `Aven.Akka.Hosting`, `Aven.Contracts`, `Aven.Serialization`

## When to run it

- Run when changing delivery protocols, actor behavior, or delivery launcher rules.
