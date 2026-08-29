# Actor runner service (`os.aven`)

This service is the authenticated server host for the portable
`os.aven:protocol:actors:plan-runner@1` contract. It is a downstream of
`api.aven.ceo`, never a route inside `aven.id` and never an open proxy.

## Trust boundary

The public app sends its short-lived `aven-services` access token only to the
allowlisted `/api/actor-runs` facade route. The facade:

1. verifies issuer, audience, service scope, and passkey assurance;
2. removes caller `Authorization`, cookies, and every `x-aven-*` trust header;
3. authenticates to this service with a fixed service bearer; and
4. forwards the original signed identity token plus its verified subject, role, and
   session projection.

The runner verifies the signed token independently and requires all three projections
to match it. A command is strict JSON and cannot contain `security`, a principal,
entitlements, grants, a tenant/database name, or a physical storage route. The runner
stamps `PlanRunSecurityContext` only after those checks.

`IDENTITY_ISSUER` remains the token's immutable public issuer. Deployments MAY set
`IDENTITY_JWKS_URL` to an internal network route for that issuer's public JWKS; this
changes key retrieval only and never changes issuer validation.

`aven.id` therefore remains responsible only for identity evidence. Product
entitlements, actor admission, artifact grants, and tenant resolution remain future
`ceo.aven` policy work at the application boundary.

## HTTP contract

The service implements the formal public path shape behind the facade:

```text
POST /api/actor-runs
GET  /api/actor-runs/{runId}
GET  /api/actor-runs/{runId}/events
POST /api/actor-runs/{runId}/continuations/{continuationId}
POST /api/actor-runs/{runId}/cancel
```

Unknown and other-user run IDs are both returned as `404`. The events endpoint is
currently a one-revision SSE response, ready to become a live subscription when the
durable repository provides change notification.

## Current backend and honest limits

`MemoryPlanRunner` is the first local server runtime and is intentionally labelled
non-durable. It proves process placement, wire portability, idempotent admission,
state transitions, subject isolation, and the split trust boundary. It does not claim
to provide leases, fencing, restart recovery, a SQL outbox, artifact grants, dynamic
actor execution, or secret continuations.

The executable refuses to start unless `ACTOR_RUNNER_STATE_BACKEND=memory` is explicit.
That prevents this development backend from being mistaken for the production design.
The next backend implements the repository and executor ports from
[`docs/actor-runtime-formal-spec.md`](../../docs/actor-runtime-formal-spec.md) and uses
the same HTTP handler unchanged.

## Local start

Copy `.env.example` values into the root development environment, configure the facade
entry below with the exact same bearer token, then run:

```sh
bun run dev:runner
```

Facade entry:

```json
{
  "prefix": "/api/actor-runs",
  "baseUrl": "http://127.0.0.1:3010",
  "targetPrefix": "/api/actor-runs",
  "bearerToken": "replace-with-the-same-32-byte-service-token",
  "roles": ["user", "admin"]
}
```

Run `bun run check:runner` and `bun run test:runner` from the repository root. The E2E
suite starts real ephemeral identity/JWKS, facade, and runner HTTP servers and signs a
real EdDSA access token; no external account or network is required.

The Docker build follows the split services' packaging convention. The project
`.npmrc` is excluded from the build context. A GitHub Packages token is mounted as
`--secret id=npm_token,env=NODE_AUTH_TOKEN`; the build constructs a minimal temporary
registry config, performs a root-excluding filtered workspace install, and removes the
config in the same build layer. The registry credential is never sent in the build
context or copied into an image layer.
