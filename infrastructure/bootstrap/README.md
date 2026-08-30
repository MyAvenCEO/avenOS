# Deployment bootstrap infrastructure

This Pulumi program owns one target's private state and backup buckets. The repository
bootstrap runs it independently for `identity`, `next`, and production, using a different
Hetzner Object Storage project, administrator, encrypted stack, and remote backend each
time. It applies target isolation policies and read-only observer access. Do not invoke it
with an improvised backend or create its buckets by hand.

The authoritative prerequisites, command, recovery output, retry behavior, and next steps
are in [Initial provisioning](../../docs/operations/initial-provisioning.md). Run its local
contract tests from the repository root:

```sh
bun run test:bootstrap
```
