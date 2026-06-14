# Aven.Submission.Contracts

## Purpose

Public contracts for submission admission and ingress-side inspection responses.

## Owns

- API message commands, submission events, response/inspection DTOs

## Does not own

- submission implementation logic, Akka integration

## Public contracts

- submission message and inspection contracts

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Contracts`, `Aven.DurableDelivery.Contracts`, `Aven.Events`, `Aven.Routing.Contracts`

## Used by

- `Aven.Submission`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Submission`, `Aven.Tests.E2E`, architecture tests
