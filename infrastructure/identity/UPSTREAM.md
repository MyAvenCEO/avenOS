# Upstream provenance

The initial Hetzner resource model and cloud-init hardening were adapted from:

- Repository: `MyAvenCEO/id.aven.ceo`
- Path: `infrastructure/aven-platform`
- Commit: `6aba9f1624987912a120faae460e709391ace07c`
- Imported: 2026-08-20

Only the identity compute foundation was retained. Finance services, recovery orchestration, local secret files, runtime bundles, inventories, and existing Pulumi encryption metadata were not imported. Future changes are native to the avenOS monorepo.
