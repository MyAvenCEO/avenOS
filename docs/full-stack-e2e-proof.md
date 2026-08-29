# Full-stack end-to-end proof

Status: executable release gate

Date: 2026-08-29

This document defines what “end to end tested” means for the fresh Aven split. A
collection of unit tests is not accepted as this proof. The release gate starts real
production-build applications, crosses the public service boundaries, and inspects the
durable result in the databases that own it.

## One command

From a clean worktree with Docker, Bun, Rust 1.93.1, `tauri-driver`,
`WebKitWebDriver`, and a package-read token available:

```sh
bun install --frozen-lockfile
bun run test:e2e:platform
```

`deploy/e2e/run.sh` builds the static Tauri frontend and an optimized Rust desktop
binary with the production custom protocol. Before compiling, it provisions the pinned,
checksum-verified ONNX Runtime and requires Tauri to copy it into the executable's
resource layout. This catches a binary that compiles but cannot open its first window
from a clean checkout. The harness then builds every service image, allocates dynamic
loopback ports, generates a disposable Ed25519 tenant-grant key, starts fresh PostgreSQL
volumes and the complete Compose topology, and runs the checkout tests and Playwright
acceptance test. It always uses the `hosting` profile during teardown, so successful and
failed runs remove their containers, networks, and volumes.

`E2E_SKIP_IMAGE_BUILD=true` is an iteration aid only. It is not release proof. The
final release run must build every image from the current worktree.

## Proven user journey

The acceptance test performs this sequence without seeding an authenticated session or
calling a private shortcut:

1. Submit and idempotently retain an authenticated, currently unknown Polar webhook as
   raw JSON.
2. Hold a name at checkout, follow the checkout email, complete the fake payment, and
   follow the separate identity setup email.
3. Create the account and first passkey, add a second passkey from a distinct virtual
   authenticator, sign out, and sign back in with that second passkey.
4. Attempt another checkout with the same account email and require the public checkout
   API to reject it with `NAME_LIMIT_REACHED`.
5. Exchange the identity session for a short-lived `aven-services` token and verify its
   issuer, audience, authentication method, scope, and maximum lifetime.
6. Wait for checkout's durable platform event to create and fully reconcile a customer
   database with Artifact, Intent, and Actor components.
7. Launch the real optimized Tauri executable through the official WebDriver bridge.
   Read its displayed device code, authorize that code in the passkey-authenticated
   identity browser, and wait for the native dashboard.
8. Import a real text fixture through the dashboard button, native Rust file reader,
   api.aven.ceo authorization boundary, Artifact Store upload, and local document actor
   graph.
9. Browse the customer's artifacts through the public facade, require the source,
   inspection, extracted-text, and classification artifacts, and byte-compare both the
   source bytes with the fixture on disk and the extracted artifact with its exact
   normalized text.
10. Require the import-created Intent, enter chat through the native dashboard, stream a
   deterministic LLM response through the authenticated LLM gateway, and require both
   the human and agent turns from the Intent API.
11. Start and finish a server Actor run through the facade, while proving a
    caller-supplied tenant grant is ignored.
12. Create a second customer environment and prove that its Intent data does not appear
    in the first environment.
13. Exercise customer Intent create, idempotent contribution append, merge, managed
    static hosting, and site lifecycle operations.

## Durable and isolation proof

The same test connects with the disposable administrator only after the user journey
and verifies:

- the unknown Polar event's original JSON, event type, processed state, and exactly one
  attempt despite duplicate delivery;
- three expected Intents in the first customer database and only one in the second;
- the exact human and agent chat contributions attached to the imported Intent;
- the source and extracted artifact records in `artifact_store`;
- the completed Actor run in `aven_actor_runs`;
- Artifact, Intent, and Actor runtime roles can read their own tables but not either of
  the other component schemas;
- the central API database contains no customer Intent schema;
- the first customer's derived runtime credential cannot connect to the second
  customer's database; and
- attempts by component roles to create a table in `public` fail.

The HTTP assertions additionally prove unauthenticated rejection, internal endpoint
authentication, facade-only checkout access, resistance to forged `x-aven-*` headers,
short-lived tenant grants, customer-route authorization, and exact static-host source
revision checks.

## CI and deployment equivalence

Both `platform-ci` and the deploy workflow install the native Linux WebKit/WebDriver
dependencies, compile and test the Rust Artifact Store workspace, run all TypeScript
checks and service suites, validate infrastructure and deployment sources, and execute
the full stack under Xvfb. Deployment can publish images only after that job passes.
The publish job emits immutable digests for Identity, API, Checkout, Static Host,
Platform Provisioner, Artifact Store, Intent Service, and Actor Runner.

Production Compose uses the same Artifact Store provisioner/runtime split, component
catalog, role roots, customer schemas, facade segments, and LLM gateway configuration
as the disposable topology. Provider credentials are the only intentional E2E
substitution: CI uses a deterministic internal SSE provider; deployment supplies the
catalog and credentials through protected environment values.

## Evidence to record before deployment

Record the tested Git commit and retain the terminal summary showing:

- checkout: 61 tests passed;
- Playwright: the full-stack acceptance test passed;
- all Compose services healthy or successfully completed; and
- no containers remain for the run's `aven-e2e-*` project.

Also run the CI-equivalent static, unit, Rust, infrastructure, deployment-source,
formatting, and image/non-root checks described in
[the infrastructure runbook](infrastructure-getting-started.md). A deployment is not
ready because only the E2E test passed, and it is not end-to-end proven because only
those component suites passed; both are required.

## Verified local run

On 2026-08-29, the branch snapshot containing this paper passed the release command
without `E2E_SKIP_IMAGE_BUILD`. The harness rebuilt the optimized Tauri application and
every service image, started new databases and volumes, and produced this terminal
summary:

- Checkout: 9 test files, 61 tests passed.
- Playwright: 1 full-stack acceptance test passed.
- Compose: every long-running service reported healthy; all migrations and initializers
  completed successfully.
- Teardown: `docker ps -a --filter name=aven-e2e-` returned no containers.

The commit containing this evidence is the tested snapshot: the proof run completed
before it was staged, and no implementation files were changed afterward.
