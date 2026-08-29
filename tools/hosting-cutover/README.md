# `aven.ceo` hosting-only cutover

This tool verifies the recovery anchor used while the WIP server stack is rebuilt.
The resulting runtime is only Caddy plus `static-site-host` in snapshot mode. It has
no database, identity API, checkout, product API, GitHub, or provider credential.

## Preconditions

- `/var/lib/aven/static-sites/active-sites.json` contains an `aven.ceo` entry.
- That entry's release contains `index.html` and stays below the binding release root.
- `/var/lib/aven/caddy` contains the existing certificate state.
- The static-host image supports `SITE_HOST_MODE=snapshot`.

Run the local verifier against a mounted or copied data root:

```sh
tools/hosting-cutover/verify-snapshot.sh /path/to/aven-data
```

The production compose file is
`services/static-site-host/docker-compose.hosting-only.yml`. Stage it in a separate
directory such as `/opt/aven-hosting`; do not overwrite `/opt/aven-api`. This keeps
rollback recoverable: stop the hosting-only project and start the old Compose project
again, without modifying either persistent data directory.

Before activation, archive `/var/lib/aven/static-sites`, the current deployment
metadata under `/opt/aven-api`, and the new `/opt/aven-hosting` directory off-host.
Bring up `static-site-host` first without publishing ports and verify it with a Host
header. Only then exchange the Caddy containers. After external HTTPS verification,
the old Compose project may be stopped without `--volumes`.
