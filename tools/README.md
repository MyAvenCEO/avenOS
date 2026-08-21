# Tools

Repository-maintained operational tools live here. Each tool has its own setup,
security model, ignored local profiles, and detailed usage documentation.

| Tool | Purpose | Entry point |
| --- | --- | --- |
| [Database tunnel](db-tunnel/README.md) | Forward a local port to PostgreSQL through a restricted, per-operator SSH account | `./tools/db-tunnel/connect.sh` |
| [Stack observer](stack-observe/README.md) | Inspect the deployed Compose stack, public health, and bounded service logs | `./tools/stack-observe/observe.sh` |

## Shared rules

- Copy each tool's `.env.example` to `.env.<profile>` and set mode `0600`.
- Never commit `.env.<profile>`, private keys, passwords, tokens, or downloaded
  runtime artifacts.
- Keep `next` and `production` identities and profiles separate.
- Pin and verify SSH host keys; do not disable strict host-key checking.
- Prefer the least-privileged credential appropriate to each operation.
