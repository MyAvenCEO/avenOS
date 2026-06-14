# Aven.Routing

## Purpose

Implements the routing authority that evaluates candidate agents and commits accepted routes.

## Owns

- `RoleRouterActor`, `RoleRoutingClient`, LLM-backed routing engine, routing attempt facts

## Does not own

- submission admission, intake durable ownership, HTTP composition

## Public contracts

- routing contracts plus role-agent-registry, intake, and LLM contracts

## Actor ownership / persistence

- `RoleRouterActor` owns routing orchestration, accepts direct durable delivery offers, and persists routing attempt events.
- `RoleRoutingClient` is a thin ask-based client over the actor boundary.

## Dependencies

- `Aven.ActorKernel`, `Aven.Contracts`, `Aven.DurableDelivery.Contracts`, `Aven.RoleAgents.Registry`, `Aven.Roles.Contracts`, `Aven.Resources.Llm`, `Aven.Resources.Llm.Contracts`, `Aven.Routing.Contracts`, `Aven.Serialization`, `Aven.WorkIntake`, `Aven.WorkIntake.Contracts`, `Akka.Persistence`

## Used by

- `Aven.Submission`, `Aven.Api`, tests

## Important rules

- Keep routing decision logic inside `RoleRouterActor`.
- Keep durable-delivery recipient handling inside `RoleRouterActor`; submission should register the router actor directly.
- Keep `RoleRoutingClient` dumb: it may route and query attempts, but it must not contain role registry, intake, or LLM decision logic.

## Tests

- `Aven.Tests.Routing`, `Aven.Tests.Submission`, architecture tests
