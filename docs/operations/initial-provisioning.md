# Initial provisioning

Status: authoritative

One local bootstrap creates the recoverable storage foundation and configures GitHub
for all three deployment targets. It generates a fresh namespace, so it can prepare a
replacement installation without reading, changing, or colliding with an existing set
of GitHub Environments.

The provider credentials remain the manual floor. Hetzner does not expose S3 credential
creation through its API, and an API token cannot safely create its own replacement.
Enter those credentials once. Do not hand-create buckets, GitHub Environments, products,
model entries, passwords, SSH keys, database roles, or service credentials.

## What the bootstrap creates

One run creates:

- a random deployment namespace such as `avenos-4f7c2a91b6`;
- versioned, private Pulumi state buckets for `identity`, `next`, and production;
- private Restic backup buckets for the same three targets;
- bucket policies that isolate each target and keep observer credentials read-only;
- raw Polar webhook endpoints for `next` and production, subscribed to every event;
- six namespaced GitHub Environments with variables, encrypted secrets, protected-branch
  policy, and optional deployment review;
- three Pulumi passphrases, three Restic passwords, and a separate bootstrap-state
  passphrase;
- validation of the current Phala-hosted RedPill chat catalog; and
- an owner-only CSV that common password managers can import.

The bootstrap administrator S3 credential remains offline. Each target deployment gets
one credential that can write only that target's state and backup buckets. Its operations
Environment gets a different credential that can read only that target's state. The
identity deployment receives the `next` and production observer credentials because it
must assemble their generated identity caller tokens.

All buckets can live in one Hetzner Object Storage project. Their explicit deny policies
provide the required isolation. Separate projects are optional defense in depth, not a
requirement for this topology.

## Prepare the provider accounts

Install and authenticate these command-line tools on the operator workstation:

```sh
gh auth login
pulumi version
gh auth status
```

The GitHub account needs repository administration. One account can bootstrap and operate
the installation. The example input omits `reviewer`, so infrastructure and deployment
runs require an explicit manual dispatch but no second-person approval.

When another operator becomes available, add their GitHub login as the optional top-level
`reviewer` field beside `repository`. The bootstrap then requires that person to approve
deployment Environments and prevents the initiating account from approving its own run.

At the providers, create these values:

1. In one Hetzner Object Storage project, generate seven S3 credentials: one offline
   bootstrap administrator, plus deployment and observer credentials for each target.
2. Create separate Hetzner compute write tokens for `identity`, `next`, and production.
3. Create separate Hetzner DNS write tokens for `next` and production. Both manage only
   the `aven.ceo` zone. `aven.id` stays outside Hetzner DNS.
4. In Polar sandbox and production, create organization API keys with product and webhook
   read/write scopes. The bootstrap creates or reconciles the endpoint and captures its
   signing secret.
5. Create send-only SMTP credentials for `next` and production.
6. Copy the RedPill API key. One key may serve both platform targets; the API facade keeps
   it server-side.

Product creation is not a provider prerequisite. Every checkout deployment applies the
published `@myavenceo/aven-ceo/pricing` manifest and creates or corrects avenNAME,
avenCEO, and their benefits before checkout becomes ready.

## Fill one owner-only input file

From the repository root, copy the template outside the checkout and restrict it before
adding values:

```sh
install -m 600 infrastructure/bootstrap/bootstrap-input.example.json \
  "$HOME/avenos-bootstrap-input.json"
```

Replace every `PASTE_...` value. Keep `sshAllowedCidrs` at `0.0.0.0/0,::/0` when using
GitHub-hosted runners; their outbound addresses change between runs. SSH still accepts
only Pulumi-generated Ed25519 role keys, disables passwords and root login, and binds each
role to a fixed command or tunnel. Narrow the CIDRs only after providing a stable
self-hosted runner or VPN path, or later deployments will fail before software reaches the
host.

Do not put the input in the repository, chat, a ticket, or shell arguments.

## Validate without changing providers

Choose a new empty owner-only output directory:

```sh
install -d -m 700 "$HOME/avenos-bootstrap-record"
bun run bootstrap:deployment -- \
  --input "$HOME/avenos-bootstrap-input.json" \
  --output "$HOME/avenos-bootstrap-record" \
  --dry-run
```

The dry run validates the input, generates the persistent namespace and passwords, and
checks the live RedPill catalog. It does not create buckets, Polar endpoints, the recovery
CSV, or GitHub configuration because the final CSV must contain the provider-generated
webhook signing secrets.

## Apply the bootstrap

Run the same command without `--dry-run`:

```sh
bun run bootstrap:deployment -- \
  --input "$HOME/avenos-bootstrap-input.json" \
  --output "$HOME/avenos-bootstrap-record"
```

Pulumi creates the six buckets through Hetzner's S3 interface, stores its bootstrap state
in the identity state bucket, and applies the isolation policies. The command then creates
or reconciles one raw, all-event Polar endpoint for each platform, captures its signing
secret, and writes the recovery CSV. Finally, it creates and fills all six GitHub
Environments. Secrets enter `gh` over standard input, not command arguments. As its last
remote action, it sets the repository variable
`DEPLOYMENT_ENVIRONMENT_PREFIX` to the new namespace. Until that final switch, the new
Environments are inert. Every infrastructure, deployment, and operations workflow rejects
a missing or malformed namespace before it resolves an Environment; scheduled monitoring
stays dormant before the first activation.

If the command stops partway through, run it again with the same input and output paths.
The generated file preserves the namespace and passwords. Do not start over with a new
output directory unless you intentionally want another infrastructure generation.

## Escrow and verify

The output directory contains:

| File | Purpose |
| --- | --- |
| `avenos-recovery.csv` | Bitwarden-compatible CSV; other password managers can map its named columns |
| `bootstrap.generated.json` | Repeatable generated inputs and Polar endpoint records |
| `bootstrap-state.json` | Encrypted Pulumi state migration copy |
| `bootstrap.remote` | Remote bootstrap backend marker |
| `pulumi-state/` | Initial local backend retained until remote state is verified |

Import `avenos-recovery.csv` into a password manager whose account recovery you have
tested. Locate the namespace, all provider credentials, the three Pulumi passphrases, and
the three Restic passwords from the imported record. Confirm that the bootstrap stack
selects from the remote backend. Then securely remove the local input and output
directory. The password manager and remote encrypted state become the recovery sources.

When a second operator becomes available, grant them recovery access and ask them to
locate the same record. This improves continuity but does not block a solo installation.

## Continue to the three hosts

Proceed with [Deployment](deployment.md#provision-fresh-infrastructure). Run the
infrastructure workflow for `identity`, `next`, and production. After the identity host
exists, add the returned `aven.id` A and AAAA records at its external DNS provider. Then
run the software deployment workflow in the same order.

Every platform deployment fetches and validates the current Phala-hosted RedPill catalog
before changing the host, then applies the Polar product manifest idempotently. Run the
bootstrap again only for a new infrastructure
generation, credential-boundary change, or disaster recovery.
