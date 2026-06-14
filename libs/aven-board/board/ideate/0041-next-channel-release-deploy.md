---
title: "next" channel — release + TestFlight + node-server deploy (Milestone 2)
summary: Extend the `next` auto-version pipeline (card 0040) so the same merge-to-next trigger also builds the apps, uploads to TestFlight, and deploys the aven-node server — fully via GitHub CI on a macOS runner.
owner: claude
created: 2026-06-14
updated: 2026-06-14
tags: [ci, release, deploy]
goal: <rough — to be made measurable in discovery>
---

# "next" channel — release + TestFlight + node-server deploy (Milestone 2)

## Context

Builds on [[0040-next-channel-autoversion]] (Milestone 1 — CalVer tags + changelog
only). Once a merge to `next` produces a unique CalVer prerelease tag
(`vYY.M.micro-next.N`, e.g. `v26.6.1-next.1`), Milestone 2 hangs the actual delivery
off that tag/trigger:

- **Mac + iOS → TestFlight** via the existing `bun run release:app:mac/ios <N>`
  scripts, run on a GitHub-hosted **macOS** runner. The scripts already support
  headless App Store Connect API uploads and CI signing modes; the gaps are
  base64-secret decoding and a macOS keychain-import step for the Mac distribution
  + installer identities (see the release-app.ts / build-appstore-macos.ts audit).
- **aven-node server** → deploy via the established sprite/relay path
  (`deploy:server:sprite`), pinned to the release commit so schema hashes match.
- Wire the `next` build number (`CFBundleVersion`) off the prerelease tag (e.g. a
  monotonic integer derived from the CalVer `-next.N` series) so TestFlight never
  sees a duplicate version.

Likely also: graduate the **stable-on-`main`** workflow (the half declared but not
wired in Milestone 1).

Public repo + standard `macos-14` runner = $0 CI minutes; secrets stay in encrypted
GitHub Secrets.

## Goal

Rough: merging to `next` ships a TestFlight build and redeploys the node server,
fully automatically, with no local Mac involved. Make this measurable in discovery
(probably: a tagged CI run that produces an uploaded build + a deployed relay at the
release commit) before building.

## Next step

Run `/aven-discover 0041` to uncover the real goal and make it measurable, after
Milestone 1 (0040) lands.
