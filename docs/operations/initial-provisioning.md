# Initial provisioning

Status: authoritative

One local bootstrap creates the recoverable storage foundation and configures GitHub
for all three deployment targets. It generates a fresh namespace, so it can prepare a
replacement installation without reading, changing, or colliding with an existing set
of GitHub Environments.

The provider credentials remain the manual floor. [Hetzner exposes S3 credential
creation only through its Console](https://docs.hetzner.com/storage/object-storage/faq/general/#is-object-storage-exclusively-managed-via-the-hetzner-s3-api),
and an API token cannot safely create its own replacement. The guided bootstrap prints
each project path, gives each of the nine credentials its exact description, and securely
asks for the one-time result before it continues. Do not hand-create buckets, GitHub
Environments, products, model entries, passwords, SSH keys, database roles, or service
credentials.

## What the bootstrap creates

One run creates:

- a random deployment namespace such as `avenos-4f7c2a91b6`;
- versioned, private Pulumi state buckets for `identity`, `next`, and production;
- private Restic backup buckets for the same three targets;
- bucket policies that isolate each target and keep observer credentials read-only;
- raw Polar webhook endpoints for `next` and production, subscribed to every event;
- six namespaced GitHub Environments with variables, encrypted secrets, protected-branch
  policy, and optional deployment review;
- three deployment Pulumi passphrases, three Restic passwords, and three isolated
  storage-bootstrap passphrases;
- validation of the current Phala-hosted RedPill chat catalog; and
- an owner-only CSV that common password managers can import.

Identity, `next`, and production each use a different Object Storage project. Each project
has an offline bootstrap administrator, a deployment credential that writes only that
target's state and backup buckets, and an observer credential that reads only its state.
The identity deployment receives the `next` and production observer credentials because
it must assemble their generated identity caller tokens. No storage administrator or
deployment credential crosses a project boundary.

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

1. Create separate Hetzner projects named `avenOS identity`, `avenOS next`, and
   `avenOS production`, and record their numeric IDs. In each project, generate an offline
   bootstrap administrator, a deployment credential, and an observer credential. The
   wizard deep-links to that project's S3 credential page and supplies the exact
   description. Hetzner shows each of these nine secrets only once, so keep its result
   dialog open until the wizard accepts both values on the same screen.
2. Identify the one Hetzner project that contains the `aven.ceo` DNS zone and record its
   numeric project ID. It may be one of the three projects above or a separate project.
3. Create separate Hetzner compute write tokens named `avenOS identity deployment`,
   `avenOS next deployment`, and `avenOS production deployment`.
4. In that one DNS project, create separate Hetzner DNS write tokens named
   `avenOS next DNS deployment` and `avenOS production DNS deployment`. Both manage the
   shared `aven.ceo` zone, while their credentials and GitHub Environments remain separate.
   `aven.id` stays outside Hetzner DNS.
5. In Polar sandbox and production, create organization API keys named
   `avenOS next bootstrap` and `avenOS production bootstrap` with organization read and
   product and webhook read/write scopes. The bootstrap creates or reconciles the endpoint
   and captures its signing secret.
6. Create send-only SMTP credentials named `avenOS next SMTP` and
   `avenOS production SMTP` when the provider supports names.
7. Fund the RedPill account and create an active API key named `avenOS chat bootstrap`.
   One key may serve both platform targets; the API facade keeps it server-side.

Product creation is not a provider prerequisite. Every checkout deployment applies the
published `@myavenceo/aven-ceo/pricing` manifest and creates or corrects avenNAME,
avenCEO, and their benefits before checkout becomes ready.

## Run the guided bootstrap

From the repository root, run:

```sh
bun run bootstrap:deployment:guided
```

The wizard opens with a complete checklist, then divides the setup into named chapters:
GitHub, Hetzner Object Storage, Hetzner Cloud, DNS, Polar, Email, AI models, client release,
infrastructure defaults, and review. It checks `gh` authentication and repository
administration, generates the persistent deployment prefix, then creates an owner-only
draft under `$HOME/avenos-bootstrap-record`. It prints the exact target project URL and
labels the exact value to enter in Hetzner's S3 **Description** field. Access keys and
secret keys share one form; provider tokens, SMTP URLs, and the RedPill key use hidden
fields. The draft and `credentials.csv` are
rewritten atomically with mode `0600` after every answer, so an interruption cannot lose a
one-time secret.

The default interface is a full-screen, curses-style form that runs entirely through Bun;
it does not require a native ncurses library or a separately installed `dialog` command.
Each screen identifies its chapter and puts the current credential or setting in a
high-contrast title band. Provider-side names and S3 descriptions are repeated as bold
instruction lines so they can be copied without confusing them with the surrounding purpose
text. Screens that need an answer also show their position among the
actionable steps; introductory pages and automatic checks do not inflate that count. On a
wide terminal, a station rail on the right lists the actionable route, highlights the
current station, and uses top or bottom ellipses when the route does not fit. Narrow
terminals keep the same form without the rail.

Use Tab or the arrow keys to move between fields and the Back/Next buttons, Enter to select,
and Ctrl+C or Escape to cancel. An S3 access key and secret key share one form and one
station: Enter moves from the first field to the second and then submits the pair. Color
distinguishes headings, verified values, and errors; all meaning is also present in text.
A valid provider check reports useful identity such as the project, region, zone,
organization, or model count in a compact evidence area belonging only to the current
chapter. Evidence never leaks into unrelated chapters, repeated evidence collapses, and
only the three latest facts remain visible. An invalid value replaces the local feedback
and remains on its screen so it can be edited. The wizard never asks the operator to type
`continue`, `retry`, or similar control words.

After an answer is submitted, a small animated progress chip immediately replaces the
form while GitHub, Hetzner, Polar, RedPill, plan validation, or provider application is
running. Local command checks time out with a retryable error instead of leaving a stale
button on screen.

On a terminal smaller than 60 columns by 20 rows it automatically uses the accessible
plain wizard. Force that mode in any terminal with:

```sh
bun run bootstrap:deployment:guided -- --plain
```

When the output directory contains one or both owner-only credential CSV files plus their
machine-readable input and generated-secret companions, startup offers **Resume** or
**Exit**. Resume opens the latest station containing a saved value and checks that station
again before advancing. This deliberately rechecks a value that may have been saved just
before a provider rejected it. Exit leaves every file untouched. A CSV without both
companion files is preserved and produces a clear error instead of being overwritten or
partially reconstructed.

On a fresh run, the wizard starts at the first field. A saved non-secret value is shown and
can be edited; a saved secret remains hidden and an empty field keeps and rechecks it. A
failed or interrupted run ends with `ERROR`. This cleanup screen is the only place that
requires a typed control word: enter exactly `keep` or `delete`, with no default. Deletion
covers the CSV, resumable input, generated secrets, encrypted bootstrap-state copies and markers, the
local Pulumi backend, and any completed recovery CSV. The prompt warns that deletion
prevents resume and can strand resources if provider changes were already applied. Keeping
them prints the preserved CSV path. A completed run ends with `SUCCESS` and the same path.
Generated values join the file after successful provisioning; manually entered provider
values are present throughout.

The CSV uses the common `Group`, `Title`, `Username`, `Password`, `URL`, and `Notes`
fields. Groups include the deployment prefix and scope, for example
`avenOS/avenos-4f7c2a91b6/next`, so multiple infrastructure generations can coexist in a
password manager. Each title names the credential role, each URL points to its provider,
and each note records its scope and purpose. The CSV is plaintext despite its owner-only
permissions; import it into the password manager and remove the local copy after
verification.

The wizard verifies credentials before moving to the next provider. Signed, read-only S3
requests confirm each Object Storage pair in its target project and report the region and
visible bucket count.
Compute tokens report the number of servers visible in their Cloud project. DNS tokens
must resolve the exact `aven.ceo` zone and report its provider ID. Each Polar pair reports
the organization name, slug, ID, and current product and webhook counts. The authenticated
RedPill catalog reports the number of Phala-hosted models and a few names. Failed checks
stay on the current form; correct its value or pair, go Back, or cancel the run.

SMTP URLs receive strict parsing and the wizard reports their host, port, and transport.
It deliberately does not attempt SMTP authentication because a portable, non-mutating
provider check is not available; deployment readiness tests the configured transport.
After applying the documented infrastructure defaults, the wizard shows the dry-run
result. Select **Apply now** on the review screen to create the buckets, Polar endpoints,
generated secrets, and GitHub configuration, or **Stop after validation** to leave provider
state unchanged. It never prints a secret or passes one in a command argument.

To resume or reconcile the same infrastructure generation, run the same command again.
To use a different owner-only location:

```sh
bun run bootstrap:deployment:guided -- \
  --output "$HOME/another-owner-only-directory"
```

Do not place the output directory inside the repository.

## Non-interactive input alternative

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

## Validate a non-interactive input without changing providers

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

## Apply a non-interactive bootstrap

Run the same command without `--dry-run`:

```sh
bun run bootstrap:deployment -- \
  --input "$HOME/avenos-bootstrap-input.json" \
  --output "$HOME/avenos-bootstrap-record"
```

Pulumi creates each target's two buckets through that target project's S3 interface,
stores three independently encrypted bootstrap states in their corresponding state
buckets, and applies the isolation policies. The command then creates
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
| `credentials.csv` | Guided-bootstrap progress and final password-manager import using common entry fields |
| `avenos-recovery.csv` | Equivalent final CSV produced only by the non-interactive bootstrap |
| `bootstrap-input.json` | Owner-only resumable input created by the guided bootstrap |
| `bootstrap.generated.json` | Repeatable generated inputs and Polar endpoint records |
| `bootstrap-state-<target>.json` | Encrypted Pulumi state migration copy for one storage project |
| `bootstrap.<target>.remote` | Verified remote-backend marker for one storage project |
| `pulumi-state/` | Initial local backend retained until remote state is verified |

Import `credentials.csv` from a guided run, or `avenos-recovery.csv` from the
non-interactive path, into a password manager whose account recovery you have tested. Map
the six named columns directly when its CSV importer asks. Locate the namespace, all
provider credentials, the three Pulumi passphrases, and the three Restic passwords from
the imported record. Confirm that the bootstrap stack selects from the remote backend.
Then securely remove the local input and output directory. The password manager and remote
encrypted state become the recovery sources.

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
