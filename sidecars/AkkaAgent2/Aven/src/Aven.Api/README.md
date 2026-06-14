# Aven.Api

## Purpose

HTTP/API host composition for the active Aven product path.

## Owns

- endpoint mapping
- `RuntimeCompositionRoot`
- HTTP request/response models
- API-specific capability seeding and runtime wiring

## Does not own

- reusable domain facts
- role/business truth
- resource gateway actors or resource operation workers
- actor-kernel ownership rules

## Public contracts

- HTTP request/response contracts and runtime composition surface

## Actor ownership / persistence

- This assembly may reference Akka for composition, but it does not own durable business facts.
- Resource access is routed through `Aven.Resources.*` gateways. API endpoints must not call stores directly when a gateway operation exists.

## Dependencies

- `Aven.RoleAgents`, `Aven.RoleAgents.Registry`, `Aven.WorkIntake`, `Aven.Capabilities`, `Aven.Contracts`, `Aven.Submission`, `Aven.Routing`, `Aven.Resources.*`, `Aven.Roles`, `Aven.Scheduling`, `Aven.SchemaRegistry`, `Aven.Trace`, `Akka.Persistence.Sqlite`

## Used by

- `Aven.Tests.E2E`, `Aven.Tests.Resources`, runtime users

## Important rules

- `Aven.Api` is composition/API runtime today and should not own reusable domain facts.
- Reset prototype runtime state when persistence shapes drift. Do not add legacy compatibility rails for old local prototype DBs.
- Gateway-mediated resource operations must stay gateway-mediated from API paths too.

## Tests

- `Aven.Tests.E2E`, `Aven.Tests.Resources`, `Aven.Tests.ActorKernel` indirectly
