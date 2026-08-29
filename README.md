# avenOS

avenOS is the open-source foundation for an Aven: an AI intended to help one person
run their life and company while the knowledge, skills, and working history it builds
remain under that person's control. avenCEO is the product built on this foundation.
This repository contains the Rust client, portable Actor runtime, service boundaries,
and deployment automation that make the system inspectable and independently
operable.

The [product model](docs/product-model.md) gives precise meanings to Aven, avenCEO,
avenOS, and working intelligence, including the guarantees the current repository does
and does not provide.

In the current application, text, voice, and documents enter the same workspace. Work
lives as an Intent with its source material, conversation, activity, artifacts, and
the skills or Actors involved. An Intent is therefore more than a chat transcript or
document-processing job: it is the durable context in which an Aven can continue a
piece of work and account for what happened.

An account starts with checkout. After a verified purchase, the customer receives a
link to create a passkey at `aven.id`. The Rust client then asks the customer to
approve that device with the same identity. Once a customer environment is selected,
the client reaches its data through `api.aven.ceo`; it never receives database
credentials or chooses a database by name.

The application is a work in progress. The current foundation proves customer-specific
databases, bounded service roles, passkey identity, persistent Intents and Actor runs,
and fresh-host deployment and recovery. It does not yet provide client-side
end-to-end encryption or a complete customer export and migration path. The complete
system runs locally and the shared `next` deployment is supported, but an independent
production installation is not. Document processing still runs in the client process
rather than in the generic server-side runner.

## What the current system does

The current application brings these parts into one flow:

- Passkeys establish the account identity, and another passkey can be added from the
  identity dashboard.
- Checkout records purchases, subscriptions, invoices, and every verified Polar
  webhook, including event types the product does not act on yet.
- Documents can be imported, processed, stored as artifacts, and discussed in the
  same Intent history.
- Skills describe reusable work; Actor Runner admits durable runs and keeps their
  status, attempts, and recovery state.
- A customer environment owns its Intents, artifacts, Actor runs, and future domain
  data in a separate PostgreSQL database.
- `aven.ceo` is rebuilt from Git and served as a static site. It does not share an
  application or session boundary with checkout or identity.

An Intent is the durable thread for one piece of work. It records what was requested,
what material belongs to it, what ran, what was produced, and where human input was
needed. An Actor is an executable participant in that work. This distinction keeps a
customer's history useful even when the implementation of a skill changes.

## Why the services are separate

Identity, commerce, customer work, and public content have different failure and
security boundaries. avenOS therefore gives each public origin one job:

| Address | What happens there | What does not belong there |
| --- | --- | --- |
| `aven.id` | Account setup, passkeys, sessions, device approval, authentication, and identity authorization | Billing, customer data, document processing, or public-site hosting |
| `my.aven.ceo` | Checkout, billing, purchase email, subscriptions, and Polar webhooks | Passkeys, sessions, or customer domain records |
| `api.aven.ceo` | Authentication of product requests, customer authorization, and fixed routing to server-side services | Browser pages, passkey registration, or arbitrary database access |
| `aven.ceo` | The public static website built from its Git source | Authentication, checkout, mutable APIs, or secrets |

The desktop client obtains a short-lived identity token from `aven.id` and sends it to
the facade. The facade checks the current product entitlement and issues a narrower
grant for one customer environment, one downstream service, and a bounded set of
actions. The downstream service verifies that grant before opening the corresponding
customer database.

```text
checkout ──creates account──> aven.id
                                  │
Rust client ──passkey/device───────┘
     │
     └──identity token──> api.aven.ceo ──tenant grant──> domain service
                                                        │
                                                        └──> customer database
```

Every customer database contains separate schemas for its installed components. Each
service function receives its own database role with only the privileges needed for
that function. Identity, commerce, and platform reconciliation keep their bounded
control data in separate central databases; they are not customer-domain stores.

The exact invariants are defined in
[Customer databases as a first-class platform boundary](docs/customer-database-platform.md).
The [implemented customer-database system map](docs/customer-database-system-map.md)
shows which parts exist today and which operational hardening remains. The
[identity, checkout, facade, and public-web cut](docs/identity-checkout-facade-cut.md)
records the four-origin trust boundary.

## Run the whole system locally

The local composition runs identity, checkout, the facade, the provisioner, domain
services, databases, email capture, and the Rust client on one Linux or macOS
workstation. It does not call a deployed Aven service, Polar, an SMTP provider, or an
LLM provider.

Install Git, Bun 1.3.13, Rust 1.93.1 through `rustup`, Docker with Compose v2,
OpenSSL, the native Tauri dependencies, and a GitHub Packages token with
`read:packages`. The
[workstation setup guide](docs/operations/workstation-setup.md) gives the exact Linux
and macOS packages and explains where the package token belongs.

From the repository root:

```sh
bun install --frozen-lockfile
bun run local:up
bun run local:account -- you@example.test
```

The last command prints an identity setup URL. Open it at the exact `localhost`
address, create a passkey, and wait for the customer database to become ready. This
command is a developer shortcut: it creates a disposable entitlement without going
through checkout. To exercise the customer-facing path, start at
`http://localhost:13200` and read the purchase email in Mailpit at
`http://localhost:18025`.

Start the client on Linux:

```sh
bun run local:app -- linux
```

Or on macOS:

```sh
bun run local:app -- mac
```

The client opens the local identity dashboard and displays a device code. Sign in
with the passkey and approve that code. You can then import a document, inspect its
artifacts, chat, and exercise persistent Intent and Actor features against the local
customer database.

When finished, remove the disposable containers, networks, and **all local volumes**:

```sh
bun run local:down
```

[Run the full stack locally](docs/operations/local-stack.md) covers the second-passkey
flow, local endpoints, checkout and email, and common failures.

## Build and prove it

Run the broad static and unit checks while developing:

```sh
bun run check
bun run test:identity
bun run test:api
bun run test:checkout
bun run test:customer-platform
```

Infrastructure, deployment, and recovery have executable tests as well:

```sh
bun run test:infra
bun run test:deploy
bun run test:recovery
```

On a prepared Linux workstation, the full product proof is:

```sh
bun run test:e2e:platform
```

It builds the optimized Rust client and real service images. The test walks through
checkout and email, first and second passkeys, native device authorization, customer
provisioning, artifact upload, document import, chat, session-local anonymous speaker
attribution, duplex interruption, Intent and Actor persistence, raw Polar retention,
tenant isolation, authorization failures, static hosting, and complete teardown. It
is evidence for that tested composition; it does not turn a synthetic voice fixture
into acoustic-device qualification or the unsupported production target into a
deployed system.

[Build and test](docs/operations/build-and-test.md) lists the complete release gate,
component commands, platform requirements, and the behavior covered by each test.

## Find the code

| Path | What it owns |
| --- | --- |
| `app/` | Svelte workspace and the Rust/Tauri client |
| `services/identity/` | The narrow `aven.id` passkey and identity service |
| `services/checkout/` | The `my.aven.ceo` checkout and billing application |
| `services/aven-api/` | The authenticated `api.aven.ceo` facade |
| `services/platform-provisioner/` | Customer database creation and reconciliation |
| `services/artifact-store/` | Customer-scoped artifact metadata and content |
| `services/intent-service/` | Customer-scoped Intent and conversation history |
| `services/actor-runner/` | Customer-scoped durable Actor execution |
| `services/static-site-host/` | Verified managed static hosting |
| `libs/` | Shared identity, customer-runtime, Actor, artifact, document, UI, and native libraries |
| `infrastructure/platform/` | Pulumi resources for the identity and platform hosts |
| `deploy/` | Local, E2E, deployment, backup, and recovery automation |
| `docs/operations/` | The authoritative operations handbook |

New stateful services join the customer platform through a component manifest,
append-only migrations, distinct owner and function roles, facade actions, an
audience-bound tenant grant, and isolation and recovery tests. They do not receive
cluster-wide customer access or caller-selected connection details.

The execution design is split across a few focused references:

- [Actor skills and goal-directed problem solving](docs/actor-skills-and-problem-solving.md)
  explains capabilities, generated plans, durable runs, and artifact-backed
  resumption.
- [Actor runtime proof strategy](docs/actor-runtime-proof-strategy.md) separates
  portable runtime conformance, document acceptance, and live-provider smoke tests.
- [Client-owned document ingestion](docs/client-document-ingest.md) describes the
  current document pipeline and its server migration boundary.
- [Generic authenticated LLM gateway](docs/llm-gateway.md) defines model discovery,
  streaming, schemas, tool calls, and provider configuration.

## Deploy and operate it

The supported shared target is `next`. Pulumi creates two replaceable Hetzner hosts:
one for `aven.id` and one for the facade, checkout, customer services, databases, and
static hosting. It also creates protected volumes, firewalls, SSH role identities,
database credentials, and internal secrets. GitHub Actions verifies a commit, deploys
immutable image digests, runs migrations and reconciliation, and checks public
readiness.

An operator still supplies the cloud and DNS credentials, approves protected runs,
and applies the returned `aven.id` A and AAAA records at its external DNS provider.
The deployment does not ask an operator to invent SSH keys, copy database passwords,
or edit files on either server.

Start with the [operations handbook](docs/operations/README.md). Its chapters cover:

- [access, generated credentials, and secrets](docs/operations/access-and-secrets.md);
- [deploying `next` and the current production limitation](docs/operations/deployment.md);
- [routine maintenance and observation](docs/operations/maintenance.md);
- [backup, restore, and fresh-host recovery](docs/operations/backup-and-recovery.md);
  and
- [bounded incident access and response](docs/operations/incident-response.md).

Production is not an independent deployment target in the current automation. The workflows,
state, backup labels, public domains, and GitHub Environment are fixed to `next`.
Moving the Git branch from `next` to `prod` does not provision or deploy another
installation. The production decisions and proof required before that changes are in
[Production status](docs/operations/deployment.md#production-status).

Hosts carry no irreplaceable configuration. Git, encrypted Pulumi state, and
encrypted off-host logical backups are the recovery sources of truth. Disaster
recovery provisions fresh hosts through the same workflow as an initial deployment,
then restores the selected backup before admitting writes.

## Keep the documentation true

The root README explains the product, its current boundaries, and the shortest local
path. The operations handbook owns procedures and secret lists; architectural papers
own their stated decisions. Other documents link to those authorities instead of
copying progressively older instructions.

Read the [repository writing standard](docs/writing.md) before changing documentation.
`AGENTS.md` maps implementation changes to the documents that must change with them.
Run the documentation gate before opening a pull request:

```sh
bun run check:docs
```

The gate validates links and headings, documented root commands, the authoritative
document set, and coverage of deployment workflow settings. It cannot decide whether
prose still tells the truth; reviewing semantic accuracy remains part of every change.
