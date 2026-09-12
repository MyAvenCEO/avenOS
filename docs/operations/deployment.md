# Application releases

Status: authoritative

This repository publishes application images and downloadable clients. Installation and
cloud operations belong to the separate avenOS-maintenance-tools repository, currently
private while the complete installation and recovery journey is being developed.

## Publish server images

Dispatch `platform-release` from `main`. It builds each application image once, scans
the resulting digests and runs the complete `platform-verification` gate against that
exact image set. Build and verification jobs receive package-read access and no
installation environment secrets. Only a successful complete gate can publish a release.

Source changes arrive through pull requests to `main`; installation channels are selected
in maintenance tools. The server release contains all eleven Linux AMD64 service images.
Identity uses its identity, database, proxy and operations images; next uses the platform
services from the same manifest. Downloadable client releases are separate, although the
verification gate still builds and tests a client package.

Publication requires `PACKAGE_READ_TOKEN` for private build dependencies and the workflow's
job-scoped package, release and attestation permissions. The existing GHCR packages are
private, so installations need package-read access. Publishing the manifest does not change
image visibility or create any cloud resources.

A GitHub release named `platform-<source SHA>-<run ID>-<attempt>` contains `release.json`,
its SHA-256 checksum and `release-attestation.jsonl`. The attestation binds the manifest
to this repository, the main branch and the publication workflow. Consumers verify that
identity and source digest, then deploy only the manifest's exact image digests. A checksum
alone is not proof of who built a release. GitHub workflow artifact expiry does not remove
the published release contract.

Platform releases are published as prereleases and explicitly excluded from GitHub's Latest
designation. The installer lists these prereleases and verifies their provenance before
deployment. Images are pushed before verification; a failed run can leave candidate images
in GHCR, but cannot publish a deployable release. Failure during asset publication leaves a
draft that the installer ignores.

## Runtime payload

The operations image includes `/release/contract-version` and `/release/deploy/`: identity
and platform Compose templates, database-role initialization, runtime lifecycle tools and
the encrypted release-archive implementation. These files are application-versioned and
tested together with the service images. The maintenance engine extracts this payload from
the pinned image without executing an arbitrary source checkout. Migrations and billing
catalog reconciliation remain in their owning service images.

## Installation channels

The maintenance repository manually selects a published release for next and promotes its
exact images to production after next verification. Identity keeps its own independent
release. A production-only installation can select a verified release directly. Neither a
source push nor release publication deploys anything. Maintenance owns Pulumi, SSH, DNS,
provider secrets, promotion receipts, backup scheduling and infrastructure retirement.

Published images and manifests must remain available for all supported installation and
recovery points. The application also retains an encrypted runtime archive with its
logical backups; see [Backup and recovery](backup-and-recovery.md).

## Polar webhook contract

This release verifies Standard Webhooks signatures. Pass the Polar webhook secret's
`whsec_…` value unchanged. The installation engine must select raw webhook payloads with
Polar API version `2026-04`. See [Polar’s signing contract](https://polar.sh/docs/integrate/webhooks/delivery).
