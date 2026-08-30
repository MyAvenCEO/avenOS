# Deployment bootstrap infrastructure

This Pulumi program owns the six private S3-compatible buckets that hold encrypted state
and backups for `identity`, `next`, and production. It applies target isolation policies
and read-only observer access. The program runs through the repository bootstrap command;
do not invoke it with an improvised backend or create its buckets by hand.

The authoritative prerequisites, command, recovery output, retry behavior, and next steps
are in [Initial provisioning](../../docs/operations/initial-provisioning.md). Run its local
contract tests from the repository root:

```sh
bun run test:bootstrap
```
