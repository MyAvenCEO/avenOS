# Actor runner service (`os.aven`)

This service hosts the portable `os.aven:protocol:actors:plan-runner@1` contract on a
server. It is an authenticated downstream of `api.aven.ceo`, never a route inside
`aven.id` and never an open proxy.

## Trust boundary

The public app sends its short-lived `aven-services` access token only to the
environment-scoped `/api/environments/{environmentId}/actor-runs` facade route. The
facade:

1. verifies the identity token and authorizes access to the selected customer environment;
2. removes caller `Authorization`, cookies, and every `x-aven-*` trust header;
3. derives the customer database and routing generation from trusted platform state;
4. signs a short-lived tenant grant restricted to the actor-run component and action; and
5. authenticates to this service with a fixed service bearer while forwarding the
   original signed identity token and tenant grant.

The runner independently verifies the identity token and tenant grant, including their
subject, session, and role agreement. A command is strict JSON and cannot contain
`security`, a principal, entitlements, grants, a tenant/database name, or a physical
storage route. The runner stamps `PlanRunSecurityContext` only after admission.

`IDENTITY_ISSUER` remains the token's immutable public issuer. Deployments may set
`IDENTITY_JWKS_URL` to an internal route for the same issuer's public keys; this changes
key retrieval, not issuer validation. `aven.id` therefore remains responsible only for
identity evidence. Product entitlements, actor admission, and tenant resolution remain
`ceo.aven` application concerns at the facade boundary.

## HTTP contract

The public facade projects its environment-scoped route to these private service paths:

```text
POST /api/actor-runs
GET  /api/actor-runs/{runId}
GET  /api/actor-runs/{runId}/events
POST /api/actor-runs/{runId}/continuations/{continuationId}
POST /api/actor-runs/{runId}/cancel
```

Unknown and other-user run IDs both return `404`. The events endpoint currently emits
one revision as SSE; it is not yet a live database subscription.

## Persistent backend and recovery

`SqlPlanRunner` stores every admitted run in the selected customer's PostgreSQL
database, under `aven_actor_runs.runs`. The database enforces subject-scoped
idempotency; a stored material hash prevents reuse of an idempotency key for a different
command. Status and cancellation operate on that durable record, with a revision check
protecting concurrent cancellation.

Execution starts only after admission commits. If the process stops in that gap, the
row remains `accepted`. Before serving an admitted request, the runner reclaims
accepted rows from that customer database. This lazy, per-customer recovery is enough
for the current side-effect-free executor and avoids giving the runner control-plane
database privileges.

The executor itself is intentionally small: it succeeds when every requested goal is
already present in the ingredients and otherwise records a terminal failure. Dynamic
planning, actor execution, HITL continuations, distributed leases, and fencing remain
future runtime work. They must be added before workers execute non-idempotent effects;
the current recovery mechanism is deliberately not a distributed job queue.

## Local start

Copy `.env.example` into your development environment and configure the facade with the
same bearer token and component contract:

```json
{
  "segment": "actor-runs",
  "baseUrl": "http://127.0.0.1:3010",
  "targetPrefix": "/api/actor-runs",
  "bearerToken": "replace-with-the-same-32-byte-service-token",
  "componentRef": "os.aven:component:actors:run-repository@1",
  "readAction": "actor-runs:read",
  "writeAction": "actor-runs:write",
  "roles": ["user", "admin"]
}
```

Then run:

```sh
bun run --cwd services/actor-runner dev
bun run --cwd services/actor-runner check
bun run --cwd services/actor-runner test
```

The focused HTTP E2E suite uses real ephemeral identity, facade, and runner boundaries.
The platform E2E additionally uses its real PostgreSQL instance to commit an accepted
run through one connection pool and recover it through a fresh runner and pool.

## Container build

The Docker build follows the split services' packaging convention. The project
`.npmrc` is excluded from the build context. A GitHub Packages token is mounted as
`--secret id=npm_token,env=NODE_AUTH_TOKEN`; the build creates a minimal temporary
registry config, performs the install, and removes the config in the same layer. The
credential is never sent in the build context or copied into an image layer.
