# Aven platform infrastructure

This Pulumi program creates two independent protected Hetzner foundations:

- `aven-identity-v1`: `aven.id` and its identity-only PostgreSQL volume;
- `aven-platform-v1`: `api.aven.ceo`, `my.aven.ceo`, static `aven.ceo`, and a
  separate platform PostgreSQL volume.

It also creates stable SSH host keys, the deployment key registration,
firewalls, `aven.ceo` DNS records, and every internal runtime secret. `aven.id`
uses an external DNS provider: the program exports `identityDnsRecords` for
manual entry and never attempts to manage that zone. The `aven.ceo` apex records
are absent unless `MANAGE_AVEN_CEO_APEX_DNS=true`; this preserves current public
hosting during a fresh deployment.

Run tests with:

```sh
bun run test:infra
```

Use the protected GitHub workflows for real preview/up operations. The complete
provider, state, secret, deployment, promotion, and rollback procedure is in
[`docs/infrastructure-getting-started.md`](../../docs/infrastructure-getting-started.md).

All server, volume, firewall, DNS, secret, and host-key resources are protected.
There is deliberately no automated destroy workflow.
