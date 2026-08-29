# Tools

Repository-maintained one-off recovery tools live here. Normal platform
operations now use the Pulumi and digest-deployment workflows documented in
[`docs/infrastructure-getting-started.md`](../docs/infrastructure-getting-started.md).

| Tool | Purpose | Entry point |
| --- | --- | --- |
| [Hosting cutover](hosting-cutover/README.md) | Validate and recover the existing `aven.ceo` static-host snapshot | `./tools/hosting-cutover/verify-snapshot.sh` |
| Stack observer | Show fixed-scope Compose status or redacted recent logs with the Pulumi-generated observe key | `./tools/stack-observe/run.sh platform ps` |
| Database tunnel | Open a host-key-pinned loopback tunnel with the Pulumi-generated tunnel key; database authorization stays separate | `./tools/db-tunnel/open.sh platform 55432` |

## Shared rules

- Never commit private keys, passwords, tokens, or downloaded runtime artifacts.
- Treat the hosting-only server and its archive as rollback state until the new
  platform apex has survived DNS convergence.
- Tunnel access does not imply database access. Use a separately issued read-only
  database role; never reuse a runtime, migrator, provisioner, or `postgres` credential.
