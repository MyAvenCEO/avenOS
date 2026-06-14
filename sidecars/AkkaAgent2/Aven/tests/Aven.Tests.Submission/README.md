# Aven.Tests.Submission

## What this suite proves

- Proves submission admission, idempotency, and routing-side inspection behavior.

## Suite type

- actor, integration

## Intentional production references

- `Aven.Submission`, `Aven.RoleAgents`, `Aven.RoleAgents.Registry`, `Aven.WorkIntake`, `Aven.Akka.Hosting`, `Aven.Contracts`, `Aven.DurableDelivery`, `Aven.Routing`, `Aven.Serialization`

## When to run it

- Run when changing submission, routing handoff, idempotency, or product message submission behavior.
