# Identity infrastructure

Pulumi project for the `id.next.aven.ceo` Hetzner foundation.

It manages:

- one protected `amd64` Hetzner server;
- one protected persistent data volume;
- one firewall;
- one deployment SSH public key;
- `id.next` A and AAAA records in `aven.ceo`; and
- cloud-init for Docker, key-only SSH, host firewalling, and persistent service directories.

All settings and credentials are injected by the protected GitHub Environment. No `.env`, `Pulumi.<stack>.yaml`, state file, host address, resource ID, or credential belongs in this directory. State is stored below `avenos/identity/.pulumi` in the private Hetzner Object Storage bucket named by `PULUMI_STATE_S3_BUCKET`. Pulumi encrypts secret state values with the passphrase held in `PULUMI_CONFIG_PASSPHRASE`.

## Commands

The local test suite needs no provider credentials:

```sh
bun run test:infra
```

Infrastructure preview and update run through `.github/workflows/identity-infrastructure.yml`. A trusted `next` release also runs `pulumi up` before deploying the application image.

## First bootstrap

1. Create the private, protected, versioned Hetzner state bucket and its dedicated S3 credentials.
2. Configure the GitHub `next` Environment using `GITHUB_HETZNER_DEPLOYMENT_CHECKLIST.md`.
3. Run `identity-infrastructure` with command `up`.
4. Read the public `ipv4Address` stack output in the GitHub job summary.
5. Capture and independently verify the new server's SSH host key.
6. Store it as `DEPLOY_KNOWN_HOSTS` and set `DEPLOY_HOST` to the stack output for the operations workflow.
7. Run `release-next` by pushing the intended release to `next`.

The first Pulumi update creates a new foundation and new state. It does not import, mutate, or delete the former host. Once the new identity flow is verified, retirement of the former host is a separate explicit operation.
