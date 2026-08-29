# AvenOS

AvenOS is a Rust/Tauri desktop application backed by a small set of independently
deployable web services. It combines passkey identity, checkout and billing,
customer-isolated data, document artifacts, Intent history, Actor execution, and a
managed public website.

The system favors explicit boundaries over infrastructure machinery: two replaceable
servers, Docker Compose, PostgreSQL, Pulumi, encrypted off-host backups, and GitHub
Actions. There is no Kubernetes cluster or shared customer database.

## The public system

| Address | Responsibility |
| --- | --- |
| `aven.id` | Signup, passkeys, sessions, device authorization, authentication, and authorization |
| `my.aven.ceo` | Checkout, billing, purchase email, and verified raw Polar webhooks |
| `api.aven.ceo` | Authenticated facade over server-side product services |
| `aven.ceo` | Static public site rebuilt from its Git source |

The Tauri client authenticates through `aven.id`, receives short-lived service tokens,
and reaches customer data only through `api.aven.ceo`. Every customer has a separate
PostgreSQL database. Artifact Store, Intent Service, Actor Runner, and future services
receive distinct roles limited to their own schema in that database.

## Repository map

| Path | Contents |
| --- | --- |
| `app/` | SvelteKit UI and Rust/Tauri desktop shell |
| `services/identity/` | Minimal identity and passkey service for `aven.id` |
| `services/checkout/` | Checkout and billing application for `my.aven.ceo` |
| `services/aven-api/` | Public authenticated facade for `api.aven.ceo` |
| `services/platform-provisioner/` | Customer database provisioning and reconciliation |
| `services/artifact-store/` | Customer-scoped artifact storage |
| `services/intent-service/` | Customer-scoped Intent and chat history |
| `services/actor-runner/` | Customer-scoped durable Actor execution |
| `services/static-site-host/` | Verified managed static hosting |
| `libs/` | Shared identity, customer-runtime, Actor, artifact, document, UI, and native libraries |
| `deploy/` | Local, E2E, shared-host Compose, backup, restore, and release automation |
| `infrastructure/platform/` | Pulumi foundation for the two Hetzner hosts |
| `docs/operations/` | Authoritative setup, test, deployment, maintenance, and recovery handbook |

## First local run

You need Git, Bun 1.3.13, Rust 1.93.1 through `rustup`, Docker with Compose v2,
OpenSSL, and a GitHub Packages token with `read:packages`. The Rust desktop client also
needs the host's native Tauri dependencies. Follow the
[Linux and macOS setup guide](docs/operations/workstation-setup.md) for exact packages.

From the repository root:

```sh
bun install --frozen-lockfile
bun run local:up
bun run local:account -- you@example.test
```

Open the printed `http://localhost` setup URL and create a passkey. Then start the Rust
client:

```sh
bun run local:app -- linux
# or
bun run local:app -- mac
```

Approve the displayed device code in the local identity dashboard. The client will
select the provisioned customer environment, after which document import, artifacts,
chat, Intent, and Actor features run entirely against the local stack.

The local endpoints are:

- identity: `http://localhost:13100`;
- checkout: `http://localhost:13200`;
- facade: `http://localhost:13000`;
- Mailpit: `http://localhost:18025`.

To remove the disposable containers and **all local volumes**:

```sh
bun run local:down
```

See [Run the full stack locally](docs/operations/local-stack.md) for the checkout/email
flow, a second passkey, troubleshooting, and the automated equivalent.

## Build and verify

Use component checks while iterating:

```sh
bun run check
bun run check:identity
bun run check:api
bun run check:checkout
bun run check:customer-platform

bun run test:identity
bun run test:api
bun run test:checkout
bun run test:customer-platform
```

The release-critical infrastructure and recovery checks are:

```sh
bun run test:infra
bun run test:deploy
bun run test:recovery
```

On a prepared Linux workstation, the full end-to-end proof is:

```sh
bun run test:e2e:platform
```

It builds the optimized Rust client and real service images, then proves checkout,
email, two passkeys, native device sign-in, customer provisioning, artifact upload,
document import, chat, persistent Intent and Actor data, raw Polar retention, tenant
isolation, authorization boundaries, managed hosting, and leak-free teardown.

The complete gate and build commands are in [Build and test](docs/operations/build-and-test.md).

## Deploy and operate

The supported shared target is `next`: a protected two-host Hetzner installation.
Pulumi creates the hosts, volumes, firewalls, SSH identities, database credentials, and
internal secrets. GitHub Actions verifies and deploys immutable image digests. Humans
provide provider credentials, approve protected runs, apply the externally managed
`aven.id` DNS records, and accept final smoke or recovery results.

Start with the [operations handbook](docs/operations/README.md):

- [configure access and secrets](docs/operations/access-and-secrets.md);
- [provision and deploy `next`](docs/operations/deployment.md#deploy-next);
- [maintain an installation](docs/operations/maintenance.md);
- [back up and recover](docs/operations/backup-and-recovery.md); and
- [respond to an incident](docs/operations/incident-response.md).

Production is **not yet an independent supported deployment target**. The current
workflows, state, backup labels, public domains, and GitHub Environment are fixed to
`next`. The exact decisions and implementation gates required before production are
listed under [Production status](docs/operations/deployment.md#production-status).
Moving the Git branch from `next` to `prod` does not deploy infrastructure.

## Architecture and contribution rules

The normative customer-data boundary is
[Customer databases as a first-class platform boundary](docs/customer-database-platform.md).
The implemented topology is mapped in the
[Customer-database system map](docs/customer-database-system-map.md). The four-origin
identity and checkout cut is described in
[Identity, checkout, facade, and public-web cut](docs/identity-checkout-facade-cut.md).

New stateful services must declare a customer component, append-only migrations,
separate owner and function roles, facade actions, tenant-grant audience, health
semantics, and isolation/recovery tests. They may not receive cluster-wide customer
access or caller-selected database credentials.

Operational procedures belong in `docs/operations/`; other documents link there
instead of copying commands or secret lists. Follow the concise
[repository writing standard](docs/writing.md) and update the owning handbook section
whenever a workflow, command, secret, endpoint, or recovery behavior changes.

## Current deployment shape

```text
Hetzner identity host                 Hetzner platform host
├── Caddy                             ├── Caddy
├── aven.id                           ├── api.aven.ceo
└── identity PostgreSQL               ├── my.aven.ceo
                                      ├── provisioner and domain services
                                      ├── aven.ceo static host
                                      └── platform PostgreSQL
                                          ├── control databases
                                          └── one database per customer
```

Hosts are replaceable. Git, encrypted Pulumi state, and encrypted off-host logical
backups are the recovery sources of truth. The disaster-recovery path is the same as a
fresh deployment, with `recover_from_backup` enabled.
