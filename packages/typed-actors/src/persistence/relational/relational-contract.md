# Relational Persistence Contract

This package's persistence model is designed to support a relational adapter with atomic actor creation, activation commit, activation failure commit, actor version checks, envelope expected-status checks, lease-owner checks, deterministic spawn idempotency, and prevention of concurrent activation for the same actor.

Required conceptual tables:

- `actors`
- `envelopes`
- `runtime_events`

Critical invariant:

- No two processing envelopes may exist for the same actor at the same time.