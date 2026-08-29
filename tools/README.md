# Tools

Repository-maintained one-off recovery tools live here. Normal platform
operations now use the Pulumi and digest-deployment workflows documented in
[`docs/infrastructure-getting-started.md`](../docs/infrastructure-getting-started.md).

| Tool | Purpose | Entry point |
| --- | --- | --- |
| Stack observer | Show fixed-scope Compose state, health summary, disk/backup status, or recent logs with the Pulumi-generated observe key | `./tools/stack-observe/run.sh platform status` |
| Database tunnel | Open a host-key-pinned loopback tunnel with the Pulumi-generated tunnel key; database authorization stays separate | `./tools/db-tunnel/open.sh platform 55432` |

## Shared rules

- Never commit private keys, passwords, tokens, or downloaded runtime artifacts.
- Rebuild public hosting from its Git source and the managed system-site declaration;
  no old host or imported volume is part of recovery.
- Tunnel access does not imply database access. Use a separately issued read-only
  database role; never reuse a runtime, migrator, provisioner, or `postgres` credential.
