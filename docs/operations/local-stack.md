# Run the full stack locally

Status: authoritative

This path runs identity, checkout, the facade, both central databases, the customer
provisioner, Artifact Store, Intent Service, Actor Runner, workers, Mailpit, and the
Rust/Tauri client on one workstation. The default calls no deployed Aven service,
payment provider, SMTP server, or LLM provider. It uses a deterministic chat mock;
you can replace that mock with an OpenAI-compatible model server on the workstation or
trusted local network.

## Connection integration status

The credential component is optional and is not added to customer environments by
default. Provisioner support accepts five independent roots:
`CREDENTIAL_SET_DB_CREDENTIAL_ROOT`, `CREDENTIAL_METADATA_DB_CREDENTIAL_ROOT`,
`CREDENTIAL_MATCH_DB_CREDENTIAL_ROOT`, `CREDENTIAL_HTTP_DB_CREDENTIAL_ROOT` and
`CREDENTIAL_IMAP_DB_CREDENTIAL_ROOT`. They derive role passwords, not encryption keys.
An explicit installation requires all five; missing roots fail rather than reuse
another service's root. The opt-in composition below supplies credential ingress,
two protected executors and installed mail/HTTP Actors. It is qualified on an isolated
local stack, not as a hosted release or an unattended mailbox synchronizer.

The `services/credential-service` ingress additionally requires
`CUSTOMER_DATABASE_HOST` (and optional port/SSL), `CREDENTIAL_SERVICE_BEARER_TOKEN`,
`CREDENTIAL_SEALING_KEY_FILE`, `IDENTITY_ISSUER`, optional `IDENTITY_JWKS_URL` and
`IDENTITY_AUDIENCE`, plus `TENANT_GRANT_ISSUER` and `TENANT_GRANT_PUBLIC_KEY`.
Only its set and metadata database roots belong in this process. The sealing file
contains the public wrapping key, never the private unsealing keys. Its default port
is 3014 and `GET /health/live` checks only that the process is live. Never expose the
ingress directly to the webview or model. Connection settings use fixed native set-only
commands through the authenticated facade. Native qualification covers creating both
connection types, rotating/revoking access, service restart and declining a Studio review.
They report the unavailable component instead of falling back to plaintext storage.

The `services/credential-executor` entry point runs exactly one
`CONNECTION_PROTOCOL` (`http` or `imap`). It requires that protocol's derived role
root as `CREDENTIAL_USE_DB_CREDENTIAL_ROOT`, a private `CREDENTIAL_UNSEALING_KEYS_FILE`,
the same identity/tenant verification settings, and the customer database endpoint.
`CONNECTION_SERVICE_BEARER_TOKEN` admits runner requests; the distinct
`CONNECTION_POLICY_VERIFY_TOKEN` reaches `CONNECTION_POLICY_URL`.
`CONNECTION_POLICY_ISSUER` and `CONNECTION_POLICY_PUBLIC_KEY` verify signed use.
`CONNECTION_ALLOWED_ORIGINS` is an operator-owned JSON list of exact HTTPS origins
(IMAP endpoints use the same origin representation). There is no production loopback
exception. Store access uses `ARTIFACT_STORE_BASE_URL` and a dedicated
`ARTIFACT_STORE_BEARER_TOKEN`; `CONNECTION_PUBLISHER_ISSUER` and
`CONNECTION_PUBLISHER_SUBJECT` must match the Store's authenticated publisher.
Its default port is 3015 and `/health/live` indicates liveness, not remote access.
Run HTTP and IMAP as separate processes with separate SQL roots and ingress tokens.

Optional API policy configuration requires all of `CONNECTION_POLICY_KEY_FILE`,
`CONNECTION_POLICY_RUNNER_TOKEN`, `CONNECTION_POLICY_VERIFY_TOKEN` and
`CONNECTION_POLICY_JSON`. The private key file has format
`aven-connection-policy-key-v1` and a `privateKey` Ed25519 PKCS8 PEM; use owner-only
permissions. It is independent of tenant-signing and credential-wrapping keys.
Policy JSON contains `revision`, exact `httpTargets` (`origin`, `pathPrefix`),
`imapOrigins`, `maximumBytes` and `maximumSeconds`. Missing configuration disables
issuance; partial configuration fails startup. These routes are private workloads,
not additional public facade targets.

Actor Runner enables the connection Actors only with `CONNECTION_RUNTIME_JSON`:
`metadataUrl` (the facade), `policyUrl`, `policyToken`, protocol-specific `http` and `imap` objects containing
`url`/`token`, and the expected `publisher` (`issuer`/`subject`). It receives neither
an unsealing key nor a protocol-use database root. Its saved-destination Actor reads
redacted metadata using the current admitted session; listing a binding is not
permission to use it. The Store accepts independent
`ARTIFACT_STORE_HTTP_EXECUTOR_BEARER_TOKEN` and
`ARTIFACT_STORE_IMAP_EXECUTOR_BEARER_TOKEN`, both recording publisher
`os.aven` / `service:credential-executor`; they must differ from all other Store
credentials. The isolated local qualification gate now covers native settings,
restart persistence, shared review, Studio composition, real Qwen, TLS HTTP, IMAP,
artifact lineage and credential dump/restore. This is sufficient for an explicit
local test composition with synthetic endpoints. Hosted key escrow, automatic mailbox
synchronization and production egress policy remain separate release gates; do not
infer hosted readiness from the local proof.

Both services have standalone build commands and Dockerfiles. Image creation does
not configure or start them in the default stack. For isolated qualification, from
the repository root with the existing package-read token exported:

```sh
bun run --cwd services/credential-service build
bun run --cwd services/credential-executor build
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN \
  -f services/credential-service/Dockerfile -t aven-connection-ingress:local .
docker build --secret id=npm_token,env=NODE_AUTH_TOKEN \
  -f services/credential-executor/Dockerfile -t aven-connection-executor:local .
```

Neither image contains operator keys. Mount only the public sealing file into
ingress and only the private unsealing ring into each protected executor. The API's
separate policy signing key must not be mounted into either image.

### Prepare a protected local composition

Use a resolved **local** Compose configuration that you already control and a JSON
policy listing allowed HTTPS origins/path prefixes and IMAP origins. Do not reconstruct
private configuration by dumping running-container environments. The generator creates
fresh keys and independent role roots; it refuses an already enabled configuration.
Choose a durable, owner-only parent directory outside Git, not `/tmp`, for real use:

```sh
bun deploy/local/connections.ts /private/local-base.json /private/allowed-targets.json /private/keys
```

The printed directory contains `compose.json`, the public sealing key, private
unsealing ring and separate policy signing key. Every file is owner-readable only.
Keep the directory together with the original base configuration. Reuse it across
restarts; generating a replacement is not key rotation. Follow the
[connection recovery boundary](backup-and-recovery.md#connection-credentials-and-operator-keys)
before saving real credentials. The generator starts no services and installs no
customer component by itself. Protected connections are a standard component of every
new workspace; the ordinary runtime upgrade adds them to older ready workspaces.

The overlay expects locally built `aven-connection-api:local`,
`aven-connection-provisioner:local`, `aven-connection-runner:local`,
`aven-connection-store:local`, `aven-connection-ingress:local` and
`aven-connection-executor:local` images. Build them from the same revision using their
service Dockerfiles. Merge the original base and generated overlay when starting that
local Compose project. Do not merge into a hosted installation.

Once all services are healthy, run the ordinary runtime upgrade. It idempotently adds
newly required default components to older ready workspaces and always refreshes
externally provisioned catalogs before the client is opened. Wait for component
readiness before opening **Settings → Verbindungen** in the desktop.

The first protected profile supports reviewed HTTPS GET/HEAD and read-only IMAP query
and selected-message reads. Saved destinations do not grant authority on their own.
Every remote operation still checks policy, binding/version and the active session.
No automatic redirects, mailbox writes, sending, OAuth refresh or unattended polling
are enabled. The older **Email** PDF-import prototype remains a separate local tool;
it does not use this credential store or establish protected Actor provenance.

For a separate synthetic stack and the native proof, use the
[connection qualification procedure](build-and-test.md#isolated-native-connection-qualification).

## Prerequisites

Complete [workstation setup](workstation-setup.md). Docker must be running and
`NODE_AUTH_TOKEN` must be available either in the shell or the user-level
`~/.npmrc`.

## Start the server stack

From the repository root:

```sh
bun run local:up
```

The command builds local service images, generates a disposable tenant signing key,
starts the topology, waits for health, updates installed components, adds newly required
default components to restored ready workspaces, and refreshes externally provisioned
catalogs. It never installs optional capabilities merely because a runtime advertises
them. Startup waits for those operations and fails instead of opening an incompatible
workspace. It then prints these endpoints:

| Surface | URL |
| --- | --- |
| Identity | `http://localhost:13100` |
| Checkout | `http://localhost:13200` |
| Facade | `http://localhost:13000` |
| Mailpit | `http://localhost:18025` |

WebAuthn uses the browser secure-context exception for the exact `localhost` origin and
RP ID. Do not replace `localhost` with `127.0.0.1` while enrolling the passkey.

## Use LM Studio or another local model

The desktop always reaches models through the authenticated local facade. Provider
coordinates and credentials stay in the API container; the webview never receives
them. `local:up` maps the application's stable chat and design model IDs onto one
OpenAI-compatible model.

The task service shares the Intent Service process but has its own
`PRODUCTIVITY_DATABASE_CREDENTIAL_ROOT`. The provisioner receives this root as
`PRODUCTIVITY_API_DB_CREDENTIAL_ROOT`; other services and the client do not receive
it. Local/E2E composition supplies an independent disposable root. Hosted payloads
must provide this required value and the `productivity` customer route to the Intent
Service's `/api/productivity` prefix before task access is enabled. Runtime preparation
generates a new root per runtime rather than reusing the Intent credential.

In LM Studio:

1. Download and load a model that supports OpenAI-style streaming, tool calls, and
   JSON output. To process scanned or image-only documents, use a multimodal model as
   well.
2. Start the local API server on port `1234` and allow connections from the local
   network. Docker reaches it through `host.docker.internal`, not through the
   container's own `localhost`.
3. Confirm the server and copy the exact model `id` from its response:

   ```sh
   curl http://127.0.0.1:1234/v1/models
   ```

Start avenOS with that identifier:

```sh
LOCAL_LLM_MODEL='replace-with-the-exact-lm-studio-model-id' bun run local:up
```

For another workstation or trusted-network provider, confirm `/v1/models`, copy the
exact model `id`, and supply an address reachable from Docker:

```sh
curl http://model-host:8000/v1/models
LOCAL_LLM_MODEL='replace-with-the-exact-model-id' \
LOCAL_LLM_BASE_URL='http://model-host:8000/v1' \
bun run local:up
```

Chat and design both require structured JSON for evidence review and tools, even
without images. If the loaded model also accepts images, advertise that additional
capability so document processing can select it:

```sh
LOCAL_LLM_MODEL='replace-with-the-exact-model-id' \
LOCAL_LLM_VISION=true \
bun run local:up
```

Set the model's request capacity with `LLM_GATEWAY_MAX_PARALLELISM` (1–32, default
5) when starting the stack. This limit is shared by chat, desktop document imports,
and Actor Runner requests through the API process. With more than one slot, one is
reserved for input routing; at capacity one, routing has bounded priority without
starving work. Feedback assessment runs in the work lane after message admission.
The catalog advertises the overall limit to both
document hosts, and the local Compose stack uses it to bound concurrent Actor Runner
runs. For a provider with five simultaneous requests:

```sh
LLM_GATEWAY_MAX_PARALLELISM=5 LOCAL_LLM_VISION=true \
LOCAL_LLM_MODEL='replace-with-the-exact-model-id' bun run local:up
```

For a model server running on the same machine, omit `LOCAL_LLM_BASE_URL` to use
`http://host.docker.internal:1234/v1`. The local Compose override maps that name on
Linux and macOS.
Override it for another host-side port when necessary:

```sh
LOCAL_LLM_MODEL='local-model-id' \
LOCAL_LLM_BASE_URL='http://host.docker.internal:8000/v1' \
bun run local:up
```

`LOCAL_LLM_VISION=true` is a declaration used for capability selection; it cannot add
vision to a model that lacks it. Without it, chat and design (including structured
evidence review)
remain available, while model-backed document vision stays disabled. For multiple
models or authenticated endpoints, set the complete `LLM_GATEWAY_MODELS_JSON` and
`LLM_GATEWAY_CREDENTIALS_JSON` catalog described in
[Generic authenticated LLM gateway](../llm-gateway.md#configuration) instead of
`LOCAL_LLM_MODEL`.

## Create an account and customer environment

```sh
bun run local:account -- you@example.test
```

Open the printed setup URL, create the first passkey, and wait for the provisioner to
finish the customer environment. The command also creates a disposable local
entitlement; no checkout or external provider is involved in this developer shortcut.

To exercise the user-facing checkout and email flow instead, begin at
`http://localhost:13200` and inspect messages in Mailpit. After buying one name,
the same verified account can return to checkout for another globally unique name.
Each completed purchase queues a separate customer environment and database.

## Start the Rust client

On Linux:

```sh
bun run local:app -- linux
```

On macOS:

```sh
bun run local:app -- mac
```

Normal desktop startup lets WebKit use hardware acceleration when available. On
Linux, if a driver produces a blank or flickering window, explicitly request the
software fallback with `AVENOS_DESKTOP_RENDERING=software bun run local:app -- linux`.
The default is `auto`; existing `WEBKIT_DISABLE_DMABUF_RENDERER` and
`WEBKIT_DISABLE_COMPOSITING_MODE` environment overrides are still respected. Unset
those variables to return to automatic hardware selection. Native E2E tests use
their own rendering profile and do not change the interactive client's settings.

For an independently frozen frontend checkpoint, build the client with
`AVENOS_CLIENT_RELEASE_BUILD=true bun run --cwd app build`, copy `app/build` into
the checkpoint, and serve that copy with
`bun scripts/local-checkpoint-server.ts /absolute/path/to/checkpoint/frontend 1451`.
The native development binary must have that same loopback origin as its compiled
`build.devUrl`; another port is not automatically authorized for native commands.
This server binds only loopback and serves the frozen directory without loading the
worktree's Vite/SvelteKit plugins. Do not use Vite's `--outDir` preview override as
checkpoint isolation: SvelteKit can still serve the current build's HTML, mixing it
with older assets after a later build. A packaged release embeds its own frontend
and does not need this checkpoint server.

The local desktop build intentionally uses device authorization instead of claiming a
deployed native passkey association. It opens the local identity dashboard, shows a
device code, and waits. Sign in with the `localhost` passkey and approve the code. The
Rust process receives the identity session and exchanges it for short-lived service
tokens. With one ready environment the client selects it automatically. With several,
open the workspace button in the left rail and choose a ready environment from the
searchable list. You can change the
selection without approving the device or signing in again; the workspace remounts
for the chosen customer database.

You can then import a document, inspect artifacts, chat through the local facade, and
exercise Intent and Actor features without deployed credentials.

To test email PDF import inside the client, open **Settings → Email**. The desktop
prototype requires Python 3.11 or newer; see the [IMAP testing guide](imap-pdf-prototype.md#use-the-tauri-client)
for mailbox setup, sample emails, local retention, and importing into the document flow.

## Add another passkey

Open `http://localhost:13100/dashboard`, authenticate, and use the passkey management
section to add another passkey. Sign out and sign back in with the new credential to
verify it independently.

## Reset the local system

This command removes the local containers, networks, and **all disposable local
volumes**:

```sh
bun run local:down
```

Use it when schema or provisioning state must start fresh. It does not touch another
Compose project, a deployed host, or any production data.

## Automated equivalent

Run the non-interactive proof on Linux:

```sh
bun run test:e2e:platform
```

The E2E run uses its own project name and dynamic ports, so it does not contend with
the interactive `aven-local` stack. See [Build and test](build-and-test.md) for its
coverage and release status.

## Common failures

- **`local:up` reports that the database files use an older PostgreSQL major
  version:** stop. The refusal protects the existing cluster from an unsupported
  in-place start. Do not run `local:down`, because it deletes the local volumes, and
  do not point the new image at the old directory. Follow
  [Update PostgreSQL across a major version](backup-and-recovery.md#update-postgresql-across-a-major-version),
  retaining a private copy of the old volumes until the restored client and recent
  Intent inventory have been accepted.

- **Uploads report `STAGING_QUOTA_EXCEEDED`:** distinguish two concurrent requests
  from 32 live reservations or 512 MiB of staged data. The Store returns 429, not a
  gateway failure. Repeating the same publication reuses its reservation. If a
  workspace lacks the running catalog, admission instead stops with
  `STORE_RECONCILIATION_REQUIRED`; provision its current catalog before retrying.
  A service restart does not provision an existing customer database. Do not raise
  quotas to hide failed publications. A fresh development workspace is also valid
  when its contents are explicitly disposable; preserve the identity database and
  passkeys when only customer work is being discarded. `local:down` is not an
  identity-preserving workspace reset.

- **Package authentication fails:** refresh the `read:packages` token and keep it in
  `NODE_AUTH_TOKEN` or the user-level `.npmrc`.
- **Rust client reports missing native packages:** repeat the Linux packages in
  [workstation setup](workstation-setup.md#linux).
- **Passkey enrollment fails:** use the printed `http://localhost` URL, not another
  hostname or IP address.
- **The customer route is not ready:** wait for the provisioner; inspect the platform
  containers with `docker compose` only when debugging the disposable local stack.
- **Ports are already in use:** stop the existing `aven-local` stack with
  `bun run local:down` before starting another interactive stack.
- **The local model is unavailable:** confirm `/v1/models` works on the host and
  `LOCAL_LLM_MODEL` exactly matches the returned model ID. If the provider runs on the
  same workstation, ensure LM Studio or the selected provider accepts local-network
  connections so Docker can reach it. `host.docker.internal` is configured by the
  local Compose override on Linux and macOS.
- **Chat works but tools or document processing fail:** use a model that implements
  OpenAI-compatible tool calls and JSON output. Document vision additionally requires
  `LOCAL_LLM_VISION=true` and a genuinely multimodal model.
