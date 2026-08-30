# Aven platform infrastructure

This Pulumi program creates one selected protected Hetzner foundation per stack:

- `identity`: `aven-identity-v1`, `aven.id`, and its identity-only PostgreSQL volume;
- `next`: `aven-platform-next-v1` at `next.aven.ceo`, `api.next.aven.ceo`, and
  `my.next.aven.ceo`; or
- `production`: `aven-platform-production-v1` at `aven.ceo`, `api.aven.ceo`, and
  `my.aven.ceo`.

It also creates stable SSH host keys, the deployment key registration,
firewalls, environment-specific `aven.ceo` DNS records, and internal runtime secrets.
`aven.id` uses an external DNS provider: the identity stack exports
`identityDnsRecords` for manual entry and never attempts to manage that zone. The
Each platform stack generates its own identity provisioning credential. The shared
identity deployment admits both credentials without giving either platform access to
identity state or to the other platform's state.

Run tests with:

```sh
bun run test:infra
```

Use the protected GitHub workflows for real preview/up operations. The authoritative
provider, state, secret, deployment, publication, and recovery procedures are in the
[operations handbook](../../docs/operations/README.md).

All server, volume, firewall, DNS, secret, and host-key resources are protected.
There is deliberately no automated destroy workflow.
