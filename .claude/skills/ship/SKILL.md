---
name: ship
description: Ship — release a human-approved aven-board item to all targets and record it as the shipped archive (the terminal state). Shipping means push/merge the shipped commit to remote main, deploy the aven-node server (bun run deploy:server:sprite), and release the Mac + iOS apps to App Store Connect (bun run release:app:all <build#>); then git mv the card from review/ into ship/. Use when someone says "ship NNNN", "release this", "deploy it", "push to main and release", "cut the release", "it's approved, ship it". Requires the item to have passed [[review]] and been verified by a human (HITL). These are outward-facing, credentialed, irreversible actions — ship NEVER runs them autonomously; a human pulls the trigger.
---

# Ship — release to all targets, then archive (the `ship/` state)

This is the terminal state of the spec-driven flow:
`ideate → discover → build → review → ship`. Read `libs/aven-board/AGENTS.md` once
before working the board. The folder a card lives in is its state; `ship/` is the
permanent **shipped/archived record** — the card lands there *after* it has been
released.

Shipping is the real release, not a checkbox. For AvenOS it means three things
land together off the same commit:

1. **Push to remote `main`** — the shipped commit is the source of truth.
2. **Server node** — `bun run deploy:server:sprite` deploys the `aven-node` relay
   to the Sprite. (`release:app:all` pins `AVEN_SERVER_BUILD_REF` to the exact
   commit so the relay builds from the same source.)
3. **Mac + iOS apps** — `bun run release:app:all <build#>` builds and uploads the
   macOS `.pkg` **and** iOS `.ipa` to App Store Connect. (`<build#>` must be unique
   per track — Apple rejects a duplicate `CFBundleVersion`.)

## Guardrails — never autonomous

Release/deploy/push-to-main are **outward-facing, credentialed (Apple + server),
and hard to reverse**. So this skill operates on the "always do / ask first /
never do" model from spec-driven environments, all at the top tier:

- **A human pulls the trigger.** Ship does not push to `main`, deploy, or upload to
  the App Store on its own. Present the exact commands and the build number, and
  wait for an explicit go from a person each time.
- **Precondition:** the card is in `review/`, its metric **passed**, and a human
  approved it (HITL). If it wasn't reviewed, run [[review]] first. If review
  failed, ship does nothing — the card goes back to [[build]] or [[discover]].
- Credentials live in `.env` / `.env.apple.local` (gitignored) — never commit or
  echo them.

## What to do

1. **Confirm the sign-off.** [[review]] verdict is Pass and a human has approved
   shipping. If any Acceptance box is still unproven, stop — back to [[review]].
2. **Confirm the release inputs with the human** — the target set (server / mac /
   ios, or all) and the unique `<build#>`. Don't assume the build number.
3. **Release (human-triggered).** Run, in order, what the human approves:
   ```sh
   git push origin <branch>         # then merge to main per the repo's process
   bun run deploy:server:sprite     # deploy the aven-node relay
   bun run release:app:all <build#> # build + upload macOS .pkg AND iOS .ipa
   ```
   Report each result faithfully; if a target fails, say so with the output and
   stop rather than limping forward.
4. **Finalize the doc.** Check the last Acceptance boxes, append a dated
   `## Progress log` line recording what shipped (targets + build# + commit), and
   bump `updated:` in frontmatter.
5. **Archive it.** `git mv` the card from `review/` into `ship/`, keeping the
   `NNNN-` prefix so the id is stable:
   ```sh
   git mv libs/aven-board/board/review/NNNN-slug.md libs/aven-board/board/ship/NNNN-slug.md
   ```
6. **Leave it.** A `ship/` item is the shipped record — **never delete it** to tidy
   up. Archive, don't erase.

## Condensed

1. Confirm review passed and a human approved (HITL) — else don't ship.
2. Confirm targets + unique build# with the human.
3. Human-triggered: push/merge to main → `deploy:server:sprite` →
   `release:app:all <build#>`. Report each result.
4. Check final boxes, log what shipped, bump `updated`.
5. `git mv` review → ship (keep the `NNNN-` prefix). Never delete a shipped item.
