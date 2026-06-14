# Aven.Routing.Contracts

## Purpose

Public contracts for intent routing, audit, clarification, and committed outcomes.

## Owns

- route input, routing attempt, audit, clarification, rejection, and commit DTOs/events

## Does not own

- routing implementation logic, Akka integration

## Public contracts

- routing contracts shared by submission, routing, work intake, API, and tests

## Actor ownership / persistence

- Contracts assembly only.

## Dependencies

- `Aven.Roles.Contracts`, `Aven.WorkIntake.Contracts`, `Aven.Contracts`, `Aven.Events`, `Aven.Resources.Llm.Contracts`

## Used by

- `Aven.Routing`, `Aven.Submission`, `Aven.Api`, tests

## Important rules

- Messages/events/views/ids only; no implementation references or Akka packages.

## Tests

- `Aven.Tests.Routing`, `Aven.Tests.Submission`, `Aven.Tests.E2E`, architecture tests
