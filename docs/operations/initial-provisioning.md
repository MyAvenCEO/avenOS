# Initial provisioning

Status: authoritative

One local setup command creates the recoverable storage foundation, configures GitHub,
provisions the selected infrastructure, and deploys the first installation. Selecting all
three targets leaves shared identity, `next`, and production running. It generates a fresh
namespace, so it can prepare a replacement installation without colliding with an existing
set of GitHub Environments.

The provider credentials remain the manual floor. [Hetzner exposes S3 credential
creation only through its Console](https://docs.hetzner.com/storage/object-storage/faq/general/#is-object-storage-exclusively-managed-via-the-hetzner-s3-api),
and an API token cannot safely create its own replacement. The guided bootstrap prints
each selected project path, gives each credential its exact description, and securely
asks for the one-time result before it continues. Do not hand-create buckets, GitHub
Environments, products, model entries, passwords, SSH keys, database roles, or service
credentials.

## What the bootstrap creates

For each selected target, one run creates:

- a random deployment namespace such as `avenos-4f7c2a91b6`;
- one repository-level GitHub Packages reader used only for dependency downloads;
- one versioned, private Pulumi state bucket;
- one private Restic backup bucket;
- bucket policies that isolate each target and keep observer credentials read-only;
- a raw Polar webhook endpoint when the target is `next` or `production`, subscribed to
  every event;
- avenNAME, avenCEO, and their visible benefits from the published pricing manifest in
  each selected Polar organization;
- a deployment and operations GitHub Environment with variables, encrypted secrets,
  protected-branch policy, and optional deployment review;
- one deployment Pulumi passphrase, Restic password, and isolated storage-bootstrap
  passphrase per selected target;
- validation of the current Phala-hosted RedPill chat catalog when a platform target is selected; and
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

Create one classic GitHub personal access token named `avenOS GitHub Packages reader`
with `read:packages` and no write scope. The wizard verifies that it can download both
cross-repository `@myavenceo` packages, saves it as the repository secret
`PACKAGE_READ_TOKEN`, and includes it in the recovery CSV. GitHub's per-workflow token
still publishes this repository's images; the long-lived reader cannot publish them.

When another operator becomes available, add their GitHub login as the optional top-level
`reviewer` field beside `repository`. The bootstrap then requires that person to approve
deployment Environments and prevents the initiating account from approving its own run.

The wizard asks only for values needed by the checked targets. A runnable first product
installation needs all three; a partial selection intentionally prepares only that part
of the recoverable foundation. At the providers, create these values when their target
appears:

1. Create the GitHub Packages reader described above.
2. Create separate Hetzner projects named `avenOS identity`, `avenOS next`, and
   `avenOS production`, and record their numeric IDs. In each project, generate an offline
   bootstrap administrator, a deployment credential, and an observer credential. The
   wizard deep-links to that project's S3 credential page and supplies the exact
   description. Hetzner shows each of these nine secrets only once, so keep its result
   dialog open until the wizard accepts both values on the same screen.
3. Identify the one Hetzner project that contains the `aven.ceo` DNS zone and record its
   numeric project ID. It may be one of the three projects above or a separate project.
4. Create separate Hetzner compute write tokens named `avenOS identity deployment`,
   `avenOS next deployment`, and `avenOS production deployment`.
5. In that one DNS project, create separate Hetzner DNS write tokens named
   `avenOS next DNS deployment` and `avenOS production DNS deployment`. Both manage the
   shared `aven.ceo` zone, while their credentials and GitHub Environments remain separate.
   `aven.id` stays outside Hetzner DNS.
6. In Polar sandbox and production, create organization API keys named
   `avenOS next billing` and `avenOS production billing`. These backend tokens are used
   by both provisioning and the checkout service. Select only `organizations:read`,
   `products:write`, `benefits:write`, `meters:write`, `checkouts:write`,
   `subscriptions:write`, `customers:read`, `orders:read`, and `webhooks:write`. Their
   expiration must cover production use and planned rotation. The bootstrap creates or
   reconciles the endpoint and captures its signing secret.
7. Create send-only SMTP credentials named `avenOS next SMTP` and
   `avenOS production SMTP` when the provider supports names.
8. Fund the RedPill account and create an active API key named `avenOS chat bootstrap`.
   One key may serve both platform targets; the API facade keeps it server-side.

Product creation is not a provider prerequisite. The bootstrap applies the published
`@myavenceo/aven-ceo/pricing` manifest as soon as it has verified each Polar key and
creates or corrects avenNAME, avenCEO, and their benefits. Every checkout deployment
repeats the same idempotent convergence before checkout becomes ready.

## Run the guided bootstrap

From the repository root, run:

```sh
bun run bootstrap:deployment:guided
```

The first screen checks one or more targets. That choice removes every irrelevant page and
recalculates the actionable step count and setup tree before data collection begins. The
wizard then opens a target-specific checklist and divides the setup into named chapters:
GitHub, Hetzner, Polar, Email, AI models, client release, infrastructure defaults, and
review. Hetzner has one subchapter per deployment project plus the shared DNS project;
Polar has one per organization; and Email has one per sending environment. It checks `gh`
authentication and repository administration, generates the persistent deployment prefix,
then creates an owner-only
draft under `$HOME/avenos-bootstrap-record`. It prints the exact target project URL and
labels the exact value to enter in Hetzner's S3 **Description** field. Access keys and
secret keys share one form; provider tokens, SMTP URLs, and the RedPill key use hidden
fields. The wizard refuses to place its record inside the repository, and every bootstrap
artifact name is also ignored by Git as a second line of defense. The draft and
`credentials.csv` are
rewritten atomically with mode `0600` after every answer, so an interruption cannot lose a
one-time secret.

The default interface is a full-screen, curses-style form that runs entirely through Bun;
it does not require a native ncurses library or a separately installed `dialog` command.
Each screen identifies its chapter and puts the current credential or setting in a
high-contrast title band. Provider-side names and S3 descriptions are repeated as bold
instruction lines so they can be copied without confusing them with the surrounding purpose
text. Screens that need an answer also show their position among the
actionable steps; introductory pages and automatic checks do not inflate that count. On a
wide terminal, a setup tree on the right groups compact item names below their chapter and
subchapter, highlights the current path, and uses top or bottom ellipses when the route does
not fit. Hetzner is grouped by project; Polar by organization; and Email by sending
environment. Narrow terminals keep the same form without the tree.

Use Tab or the arrow keys to move between fields and the Back/Next buttons, Enter to select,
and Ctrl+C or Escape to cancel. An S3 access key and secret key share one form and one
station: Enter moves from the first field to the second and then submits the pair. Color
distinguishes headings, verified values, and errors; all meaning is also present in text.
A valid provider check reports useful identity such as the project, region, zone,
organization, or model count in a compact evidence area belonging only to the current
chapter. Evidence never leaks into unrelated chapters, repeated evidence collapses, and
only the three latest facts remain visible. An invalid value replaces the local feedback
and remains on its screen so it can be edited. The wizard never asks the operator to type
`continue`, `retry`, or similar control words during ordinary data collection.

After an answer is submitted, a small animated progress chip immediately replaces the
form while GitHub, Hetzner, Polar, RedPill, plan validation, or provider application is
running. During the final apply, the screen shows the current numbered provider operation,
its detail, elapsed time, and recent completed operations. The owner-only
`bootstrap-apply.log` keeps redacted command diagnostics for a failed retry. Local command
checks time out with a retryable error instead of leaving a stale button on screen.

If an interrupted Pulumi update created one of this generation's deterministic buckets
before its local checkpoint recorded ownership, the next apply recognizes only that exact
expected bucket, imports it into the protected stack, and continues reconciliation. It
never adopts an unrelated bucket name.

On a terminal smaller than 60 columns by 20 rows it automatically uses the accessible
plain wizard. Force that mode in any terminal with:

```sh
bun run bootstrap:deployment:guided -- --plain
```

When the output directory contains one or both owner-only credential CSV files plus their
machine-readable input and generated-secret companions, startup offers **Resume**,
**Uninstall**, or **Exit**. Resume first reopens the saved target selection, then rechecks every saved,
testable credential with read-only provider calls. The current credential and check count
remain visible. A rejected credential opens its own station immediately so it can be
replaced before Apply; otherwise the latest relevant saved station opens. Exit leaves every
file untouched. A CSV without both companion files is preserved and produces a clear error
instead of being overwritten or partially reconstructed.

On a fresh run, the wizard starts at the first field. A saved non-secret value is shown and
can be edited; a saved secret remains hidden and an empty field keeps and rechecks it. A
failed provider-bootstrap or interrupted run ends with `ERROR`. Its cleanup screen requires
one exact typed choice: enter `keep` or `delete`, with no default. Deletion
covers the CSV, resumable input, generated secrets, encrypted bootstrap-state copies and markers, the
local Pulumi backend, and any completed recovery CSV. The prompt warns that deletion
prevents resume and can strand resources if provider changes were already applied. Keeping
them prints the preserved CSV path. When a provider returned a concise error, the recovery
screen shows that redacted response as well as the diagnostic-log path. A completed run
ends with `SUCCESS` and the same path.
Generated values join the same file as soon as they exist; manually entered provider
values are present throughout. During the initial rollout this includes each GitHub run,
the deployed Git revision, exact state and backup bucket names, public service origins,
and the `aven.id` A and AAAA records. The DNS values are saved before the wizard asks the
operator to set them, so cancelling at that screen does not lose the handoff.

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
result. Select **Apply now** on the review screen to create the buckets, Polar endpoints
and manifest products, generated secrets, and GitHub configuration, then provision and
deploy the selected full topology. Select **Stop after validation** to leave provider
state unchanged. It never prints a secret or passes one in a command argument.

The bootstrap stores the checked targets in `deploymentTargets`. Rerunning the same saved
generation may check a different combination; previously entered one-time credentials
remain in the owner-only files. A fresh complete installation still needs all three targets.
When a target is added later, the bootstrap also refreshes previously prepared GitHub
Environments so cross-target read-only state references remain complete. It does not rerun
their storage or external-provider changes.

After the provider bootstrap, the same process dispatches one combined infrastructure
preview and one combined apply. Protected Pulumi resources reject destructive replacement.
The setup then displays the exact external A and AAAA records for `aven.id` and waits until
public DNS returns those values. Finally, it runs the complete release gate once, publishes
each image once, deploys `identity`, `next`, and production in order, and checks all seven
public readiness endpoints. Successful GitHub run IDs, the DNS handoff, and final
verification time are stored in the owner-only generated record and mirrored into
`credentials.csv`, so rerunning resumes instead of repeating completed stages and the
password-manager import remains the complete operator handoff. `initial-rollout.log`
records only stage names, status, and GitHub run URLs; it contains no credential values.

If a GitHub infrastructure or deployment run fails, the wizard reads its failed-step log,
redacts known secrets, and puts the concise provider reason directly on the recovery
screen. Enter exactly `retry`, `keep`, or `delete`; no option is selected by default.
Correct the external issue before choosing `retry`. The wizard first checks the saved run
and Pulumi checkpoint, reuses successful work, and dispatches only the first failed stage.
`keep` stops with every recovery artifact intact for a later resume. `delete` removes those
artifacts and prevents resume.

A common first-installation repair is an obsolete DNS record. Hetzner rejects an A or
AAAA record when a CNAME still owns the same name. The recovery screen identifies the
exact names and types, for example `next CNAME blocks A and AAAA`. Remove the obsolete
CNAME at the authoritative `aven.ceo` provider, return to the still-open wizard, and enter
`retry`. Pulumi then creates and owns the required records; the conflict does not require
a fresh bootstrap generation.

## Uninstall a saved generation

Use the same guided command when a test installation must be removed completely:

```sh
bun run bootstrap:deployment:guided
```

Choose **Uninstall** on the saved-setup screen. The wizard prints the exact generation,
targets, GitHub Environments, and destructive order. No deletion begins until the operator
types `uninstall <deployment-prefix>` exactly; there is no default or shortened answer.
Type `back` on that confirmation screen to return without changing provider state.

The teardown is bounded by the saved record. It removes resources in dependency order:

1. production, `next`, and identity Pulumi stacks in reverse order, including servers,
   volumes, firewalls, generated SSH material and secrets, and Pulumi-managed `aven.ceo`
   DNS;
2. the saved Polar webhook endpoints and the exact SSOT catalog identified by its metadata;
   Polar products and meters are archived where the provider retains them, benefits are
   removed, and financial history remains subject to Polar retention;
3. the generation's GitHub Environments and, only when this generation is still active,
   its repository deployment variables and package-reader secret; and
4. versioned Pulumi state and Restic backup buckets last, after their bootstrap state has
   been moved into an owner-only local teardown backend.

Pulumi protections and Hetzner provider deletion locks remain enabled during normal
operation. The uninstall process disables them only for exact resource URNs already present
in the saved stacks. It does not expose a destroy input in a GitHub workflow.

If a provider call fails, the screen shows the redacted reason and `uninstall.log`. Correct
the issue and type `retry`; completed stages are detected and skipped. Type `keep` to stop
with the local teardown state intact. Do not delete the record while remote resources
remain, because it contains the credentials and state needed to finish safely.
Before deleting infrastructure, the command also refuses to continue while a platform
workflow is active, another GitHub generation is selected, or an SSOT Polar product has an
active subscription. Cancel or revoke a remaining subscription only after handling its
customer, billing, and retention consequences, then retry.

After success, choose one exact local cleanup action with no default:

- `reuse` keeps only `bootstrap-input.json`, which contains the manually supplied provider
  credentials, and removes generated secrets, CSVs, logs, state copies, and markers. The
  next guided run creates a new deployment prefix and revalidates the retained input.
- `delete` removes the complete local bootstrap record.

The setup did not create the Hetzner Cloud or S3 credentials, Polar API keys, SMTP
credentials, RedPill key, GitHub personal token, or external `aven.id` DNS records. It does
not revoke or delete them. Remove the now-stale `aven.id` A and AAAA records at its external
DNS provider. Reuse or revoke provider credentials according to the next installation and
the provider's own access review.

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

Set `deploymentTargets` to any non-empty combination of `identity`, `next`, and
`production`, then remove unselected target sections. Replace every remaining `PASTE_...`
value. Keep `sshAllowedCidrs` at `0.0.0.0/0,::/0` when using
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

Pulumi creates each selected target's two buckets through that target project's S3
interface, stores independently encrypted bootstrap state in the corresponding state
buckets, and applies the isolation policies. The command then creates or reconciles one
raw, all-event Polar endpoint for each selected platform, captures its signing secret,
applies the product and benefit manifest, and writes the recovery CSV. Finally, it creates and fills two GitHub
Environments per selected target. It records the cumulative prepared target list in
`DEPLOYMENT_TARGETS_JSON`, so scheduled monitoring ignores targets that do not exist.
Secrets enter `gh` over standard input, not command arguments. As its last
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
| `credentials.csv` | Guided-bootstrap progress and complete password-manager handoff using common entry fields |
| `avenos-recovery.csv` | Equivalent final CSV produced only by the non-interactive bootstrap |
| `bootstrap-input.json` | Owner-only resumable input created by the guided bootstrap |
| `bootstrap.generated.json` | Repeatable generated inputs and Polar endpoint records |
| `bootstrap-state-<target>.json` | Encrypted Pulumi state migration copy for one storage project |
| `bootstrap.<target>.remote` | Verified remote-backend marker for one storage project |
| `pulumi-state/` | Initial local backend retained until remote state is verified |
| `bootstrap-apply.log` | Owner-only redacted activity and command diagnostics from the latest apply |
| `uninstall.log` | Owner-only redacted activity and command diagnostics from the latest teardown attempt |
| `uninstall-pulumi-state/` | Owner-only temporary backend used so state and backup buckets can be deleted last and retries remain possible |
| `uninstall-platform-<target>.json` | Encrypted platform stack checkpoint used to select exact provider-lock changes |
| `uninstall-bootstrap-<target>.json` | Encrypted storage stack copy retained beside the local teardown backend for retry |
| `initial-rollout.log` | Owner-only stage status and GitHub run URLs for resumable first deployment |

Import `credentials.csv` from a guided run, or `avenos-recovery.csv` from the
non-interactive path, into a password manager whose account recovery you have tested. Map
the six named columns directly when its CSV importer asks. Locate the namespace, all
provider credentials, the three Pulumi passphrases, and the three Restic passwords from
the imported record. Also locate the storage bucket names, GitHub run references, deployed
revision, public origins, and exact `aven.id` A and AAAA records. Confirm that the
bootstrap stack selects from the remote backend.
Then securely remove the local input and output directory. The password manager and remote
encrypted state become the recovery sources.

When a second operator becomes available, grant them recovery access and ask them to
locate the same record. This improves continuity but does not block a solo installation.

## Finish the first installation

Do not dispatch another workflow after a successful complete setup. The guided command
already provisions and deploys the full topology. Its only manual deployment pause is the
external `aven.id` DNS screen; enter the displayed records at that provider, then choose
**Check DNS**. A successful run ends with:

```text
SUCCESS: the first avenOS installation for avenos-… is running.
```

Use [Deployment](deployment.md#deploy-an-update) for later updates. The manual
infrastructure and deployment workflow sections remain the repair and operator-controlled
paths when one stage must be rerun independently.

Every platform deployment fetches and validates the current Phala-hosted RedPill catalog
before changing the host, then applies the Polar product manifest idempotently. Run the
bootstrap again only for a new infrastructure
generation, credential-boundary change, or disaster recovery.
