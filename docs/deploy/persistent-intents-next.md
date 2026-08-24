# Persistent intents on `next`

The standalone Intent Service requires five new, distinct GitHub Environment secrets:

- `INTENT_SERVICE_BEARER_TOKEN`
- `INTENT_SERVICE_DIRECTORY_BEARER_TOKEN`
- `INTENT_SERVICE_PROVISIONER_BEARER_TOKEN`
- `INTENT_SERVICE_RUNTIME_PASSWORD`
- `INTENT_SERVICE_PROCESSOR_BEARER_TOKEN`

Each must contain 32–128 URL-safe letters, digits, `_`, or `-`. Do not reuse an Artifact
Store or Processor credential. Four optional variables control pool and memory bounds:
`INTENT_SERVICE_MAX_TENANT_POOLS`, `INTENT_SERVICE_CONNECTIONS_PER_TENANT`,
`INTENT_SERVICE_TENANT_REFRESH_SECONDS`, and `INTENT_SERVICE_MEMORY_LIMIT`.

To deploy:

1. Merge the PR into `main` only after CI is green.
2. Run the `promote` workflow with `main → next`; do not merge or rebase `next` by hand.
3. Let `release-next` publish the Aven API, Artifact Store, and Intent Service images,
   deploy the stack, and build the desktop apps.

The environment worker independently reconciles every eligible customer database to
Artifact Store schema `3`, Processor schema `5`, and Intent Service schema `1`. The
rollout installs `intent.declaration@1` plus the new `aven_intent_service` projection.
There are no deployed Processor-owned intents to migrate. Processor schema 5 revokes
its runtime from the empty prototype schema; that shell remains for one-generation
rollback compatibility and is not read or imported by the Intent Service.

Success means `/api/health/status` reports `overall=healthy`, Intent Service is
reachable, and rollout drift is zero. Then sign in with the
`next` desktop app, upload one file, and verify that its intent, File-skill stages,
derived artifacts, and chat contributions survive an app restart.

All existing Artifact Processor vision settings must remain valid. See
[GitHub deployment](../../services/aven-api/docs/github-deployment.md) for the complete
secret and variable inventory.
