# Aven.Trace

## Purpose

Implements the derived trace projection and read/query surface.

## Owns

- `TraceProjectionActor`, `TraceStore`, `TraceQueryService`, invariant checking

## Does not own

- durable actor truth, product command handling, role/business fact ownership

## Public contracts

- trace contracts from `Aven.Trace.Contracts` and semantic events from `Aven.Events`

## Actor ownership / persistence

- May reference Akka for projection subscription, but trace projections are not the durable source of truth.

## Dependencies

- `Aven.Contracts`, `Aven.Events`, `Aven.Serialization`, `Aven.Trace.Contracts`, `Akka.Persistence`, `Microsoft.Data.Sqlite`

## Used by

- `Aven.Api`, `Aven.Debug`, tests

## Important rules

- Trace projections are derived from semantic events and are not durable actor truth. Keep product recovery dependent on actor journals, not trace tables.

## Tests

- `Aven.Tests.Trace`, `Aven.Tests.E2E`, architecture tests
