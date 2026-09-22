# Saved tasks

Tasks keep the same identity and history when someone works through chat, a list
or a board. This package owns one domain contract and reducer, with typed Actor
ports for Skill composition. Productive Studio installation is not enabled yet:
the server catalog still needs the same bounded task authority and receipt handling,
not a separate task executor. A completed
task is not deleted: archiving and restoring are explicit revision-checked changes.

`actor.ts` provides the installed Actor contract and handlers. `postgres.ts` writes
tasks, immutable command receipts and revisions in one transaction using the
productivity database role. `remote.ts` calls that same service through a host-owned,
authenticated transport. `trial.ts` exercises the same reducer in an explicitly
temporary copy; it cannot fall back to the productive repository.

The host supplies the owner, operation ID and conversation cause. Model parameters
cannot select the owner. Reusing an operation ID with the same material returns its
original receipt; different material conflicts. Updates name exact current task
revisions, and a stale member rejects the whole batch. Group `team` is an organizing
label within the owner's list, not permission to read another person's tasks.
Creation accepts an optional initial `status`: it defaults to `open`, while an
explicitly requested `doing` or `done` state is saved in the first revision, without
a second update or implicit archiving. Unknown fields remain rejected before writing;
the Actor identifies those fields in its correction feedback.
An explicit `update` can also change `intentId` (or clear it with `null`). The
service checks a non-null destination through the separate Intent-read permission;
it must exist for the same owner and must not be merged or deleted. This preserves
the task ID and revisions. The command's conversation cause stays at its origin;
moving a task does not move the conversation or rewrite prior receipts. Destination
validation observes the Intent at command admission, not an enduring availability
guarantee if someone archives or deletes it later.

Due values distinguish an all-day date, an instant with an IANA display timezone,
and a start/end window. Lists are bounded live pages, not snapshot queries. Every
consumer must preserve the returned completeness and continuation information.
The Actor also bounds each list result to 7,000 JSON characters, below the chat
evidence budget. It returns whole task rows and advances the cursor only through
those rows; the answering model, reviewer and restored history see the same page.
An individually oversized row produces an explicit read failure, not a false empty
or complete result. Mutation receipts are not repaginated or rewritten.

The desktop list and board use the registered `TaskWindow` component over the same
task Actor and service. The Intent surface renders that registered component, not a
second generic view reconstructed from the Actor manifest. Opening a window must
be qualified by its visible controls and saved rows, not only its open-state receipt.

`evidence.ts` projects large validated task results for bounded chat history and
answer review. It reuses the task page/receipt schemas rather than defining another
contract. The projection preserves task IDs, revisions and user-visible values,
while removing owner and creation/update metadata. If rows still exceed the supplied
budget, it omits whole rows and reports how many. Service-page completeness and
retained-row completeness are separate: neither a historical receipt nor a bounded
excerpt proves the current state or the absence of tasks outside its selection.

The Intent Service hosts the productivity HTTP handler with separate database pools
and credentials. It validates conversation provenance through a separately signed
Intent-read grant. It never gives the productivity role access to Intent tables.

The shared package, service and browser list/board have passed a
real-Qwen/HTTP/PostgreSQL proof, including reload and archive/restore. Focused native
list/board controls and facade integration have also passed. A combined real-Qwen
native journey creates tasks, reloads, reassigns one to another Intent without
moving the conversation, reloads again and displays both rows in the registered
task view. Productive nested Skills still need their separate authority and release
gates. The Actor contract alone does not establish that product guarantee.
See [build and test](../../docs/operations/build-and-test.md#live-studio-workday).
