# Skill Studio v2 verification

Status: implemented bounded production vertical, 16 September 2026

This record defines what the current Skill Studio proves. It deliberately separates
working product behavior from grammar foundations that can be inspected and edited
but are not yet executable.

## Product behavior

- Explore any visible artifact and request opportunities from the current authorized
  Actor catalog.
- Browse every permitted Actor and operation. An operation is composable only when a
  trusted installation supplies exact Store schemas, procedures, placement and public
  settings.
- Compose without manual wiring. Exact named ports connect automatically; required
  artifacts become visual inputs; optional ports remain explicit; protected inputs
  never enter the artifact graph; bounded settings become generated controls.
- Save revision-checked drafts and publish immutable `studio.skill@2` artifacts. A new
  revision retains its predecessor and exact nested Skill artifacts as provenance.
- Reuse Skills by exact artifact ID. Nested interfaces, parameters, cycles, authority
  and transitive children are validated before publication and again at execution.
- Run finite invoke/nested-Skill programs through the generic Actor executor. Runtime
  authorization is rechecked, cancellation stops new work and publication, committed
  results are reprojected through trusted Store schemas, and the declared public result
  is returned rather than an incidental internal artifact.
- Inspect output provenance and preview a Skill visually in the Artifact library
  without planning, executing, publishing or reading file content.
- Connect future matching artifacts to an exact Skill under the current authenticated
  session. While Studio is visible it runs bounded authorized synchronization; an
  ordinary arrival starts a connected Skill without pressing Sample or Sync. Admission
  accounts for activation as well as every internal and nested publication, rejecting
  both direct and control-artifact feedback loops.
- Use the same operations from the Studio Actor. The agent can analyze state and
  catalog opportunities, create a closed v2 definition, compose an authorized
  operation or exact child Skill, and apply typed semantic edits with an inspectable
  before/after change.

## Fail-closed boundaries

- `achieve`, `review`, `forEach`, and observation-based branches are valid authoring
  vocabulary but the current runtime does not execute them. Preview returns
  `RUNTIME_FEATURE_UNAVAILABLE`, publication is blocked, and the UI explains the issue.
- Connections advance only during freshly authenticated Studio or agent synchronization.
  Live IMAP/HTTP supervisors, service identities, credential leases and unattended
  dispatch are a separate Source-worker milestone.
- A manifest alone is not runnable. Document and client Actors remain visible when
  permitted, but are blocked until their owning package installs the complete generic
  execution descriptor.
- One program is bounded to its declared policy limits. Store publication remains the
  authority for artifacts and provenance; mutable draft, connection and run state stays
  in the customer Actor schema.

## Executable evidence

| Proof | Coverage |
| --- | --- |
| `libs/aven-actors/tests/studio-v2.test.ts` | Closed v2 grammar, named ports, condition narrowing, collection/child contracts and capability matching |
| `libs/aven-actors/tests/studio-composer.test.ts` | Visual/agent auto-wiring, optional/protected inputs and generated settings |
| `libs/aven-actors/tests/studio-edit.test.ts` | Agent-safe creation and semantic modification with stable identities and diffs |
| `app/tests/studio-actor.test.ts` | Agent analyzes, creates, composes and modifies through the actual bus Actor |
| `services/actor-runner/tests/skill-studio-productive.e2e.test.ts` | Catalog → compose → draft → immutable publish → generic execution → committed output and provenance |
| `services/actor-runner/tests/studio.persistence.e2e.test.ts` | Real PostgreSQL and current Rust Artifact Store: nested Skill, connected delivery, Store lineage, replay, restart and draft isolation |
| `services/actor-runner/tests/studio-v2-runtime-safety.test.ts` | Cancellation, execution-time revalidation, activation ownership, public-result selection and feedback-loop rejection |
| `services/actor-runner/tests/studio-v2-validation.test.ts` | Shared preview/publication validation, Store-type integrity, transitive children and honest runtime readiness |
| `app/tests/studio-ui.mjs` | Real Svelte journey: discover, compose, parameterize, publish, run, trace, connect, automatic ordinary arrival and nest |
| `app/tests/artifact-skill-preview.mjs` | Pure Skill card and visual Artifact-library preview |
| Artifact Store core built-in tests | Registered v2 Skill, activation and subscription payload/reference contracts |

The browser tests simulate only the authenticated native IPC boundary. The focused
productive test uses the real shared composer, publisher, compiler, generic executor
and Store runtime port. The restored persistence test was also executed on 16 September
2026 against an isolated PostgreSQL schema and a fresh database served by the current
Rust Artifact Store binary: 2 passed, 0 failed. The broader repository CI checks are
separate. Provider-backed model tests are not required for this deterministic
email-brief acceptance path.
