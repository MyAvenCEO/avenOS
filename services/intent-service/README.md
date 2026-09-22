# Intent Service

The Intent Service is the durable owner of conversation intents and their ordered
contributions. It is an independent domain service behind `api.aven.ceo`; it owns no
passkeys, checkout records, facade routes, or provider credentials.

Interactive requests require the private facade bearer token, the original signed `aven.id`
JWT, and a short-lived tenant grant. The service independently verifies both signatures
and binds the subject, role, session, customer environment, database, generation,
component, and action before deriving its customer-specific `int_api` credential.

Intent data only exists in that customer's database, under `aven_intents`. The service
has no cluster credential, cannot migrate schemas, and cannot access another component's
tables. The platform provisioner is the sole owner of installation and role grants.

`POST /api/intents/input` atomically stores the selected/new Intent, exact human
contribution, admission receipt and turn outbox entry. It additionally verifies the
facade's one-turn work certificate; no login token is saved. An input ID can be
admitted once across all its revisions. Receipt lookup survives Intent archival,
merge and deletion. Unbound work is cancelled; bound work holds its FIFO position
until effects are reconciled, even after restoration. Completed effects are not undone.

`GET /api/intents/{id}/turns` returns a bounded, keyset-paged queue projection for the
authenticated owner. It exposes contribution links and admitted/accepted/finished
times, not prompts, work certificates, dispatch leases, raw errors or journals.
Accepted means the outbox acknowledged runner admission, not that a worker is live.
Expired or old-generation unfinished work appears blocked even before supervision
runs; that read changes no state. A recorded uncertain-effect reason takes priority
over expiry so permission renewal is not mistaken for reconciliation. Cursors are
bound to the owner, Intent and current generation. Archived queues remain readable;
deleted and foreign queues do not. Native background controls are not yet enabled.

`POST /api/intents/{id}/turns/{turnId}/stop` accepts only a command ID and the
observed control revision. It requires the owner's authenticated write permission;
neither the model nor a work certificate can issue this user control. It atomically
withdraws further authority and records an immutable system receipt. Retrying that
exact command returns the receipt, not another contribution or action. A stale
revision cannot stop renewed work. Already published answers are not rewritten.
Queued, unbound work is cancelled immediately; bound work is shown as **stopping**,
with its FIFO barrier retained. An in-flight action may still complete. The supervisor
releases a requested stop only after the exact runner is terminal, its executor has
settled, and every started tool has a recorded outcome. It records a separate system
receipt, not an invented agent answer. A lost tool acknowledgement instead retains
the barrier and an uncertain-effect warning; it needs receipt reconciliation. Stopping
never claims a remote effect was rolled back. Native controls and child-Skill lifetime
integration remain gated. Current-generation owners can
withdraw old-generation work and can stop while execution is paused.
The worker rechecks authority before each new model or tool call. Cancelled, failed
and blocked historical requests are explicitly identified to the shared Chat engine,
so retaining a message does not make it an outstanding request for the next turn.

The internal outbox repository coordinates FIFO dispatch and final publication.
The owner-visible queue exposes the admission-reserved response identity before
execution, separately from its null-until-published output contribution. This lets
pending feedback retain an exact response/request pair without treating it as a
saved answer. The reserved identity survives dispatch and recovery.
Its read-only `/internal/v1/work/verify` endpoint requires a service credential and
matching signed component/work grants. It checks the exact accepted certificate,
bound run, active Intent, workspace generation and unexpired authority; it exposes no
conversation content. The facade uses this alongside the runner's lease check before
exchanging delegated work authority.
`POST /internal/v1/work/turn` uses that same execution-bound authority to return the
exact accepted input and pinned prior context, or publish its final result. The signed
binding supplies the subject, turn and run; request bodies cannot replace them.
Publication additionally requires `intents:write`. Context never echoes the work
certificate and keeps at most 80 whole recent contributions within two MiB, marking
omitted older coverage. It does not truncate a tool receipt into invalid JSON.
Completed/cancelled work cannot reopen context using an earlier component grant.
Lost final-publication acknowledgements still use the dedicated completion lookup;
this endpoint does not renew ended work to replay publication.
Its `search` and `read` commands reuse the owner-scoped indexed Intent/message
readers, including archives and feedback. They cannot select another owner or change
the accepted destination. Intent previews read at most ten bounded message excerpts
and ten activity summaries without fetching large tool payloads. Each excerpt retains
its exact message ID and a Unicode-safe continuation offset. Invalid cursors, excessive
limits and out-of-range offsets are rejected; completed work cannot reuse a history
grant. A preview is not a complete transcript or independent verification of an old
assistant claim.
Message-search excerpts use exact original SQL substrings as well: each includes
`sourceId`, `offset`, `nextOffset` and `totalChars`. The shared engine retains only
the returned range for quotation, without fetching the same passage again. Search
coverage remains separate from source-text coverage; document summaries and unmarked
snippets are not promoted to quotation evidence.
The native retrieval adapter uses `GET /api/intents/{id}/preview` for that same
projection through ordinary identity admission. Full conversation views continue to
use Intent detail; short agent lookups no longer transfer its tool payloads.
`POST /internal/v1/work/turn/lifecycle` supplies that lookup and the initial worker
certificate handoff. It requires the service bearer plus an exact, current signed
Intent placement for `CUSTOMER_RUNTIME_ID` (default `primary`). Its closed run
reference must match the admitted subject, turn, run, input revision and material.
It returns only waiting/ended/ready state or a saved completion ID. Only `resume`
of a live bound turn returns its original work certificate; no history is returned.
The certificate still cannot read context or invoke tools without fresh current-access
and runner-lease checks. Completed work returns its receipt even after the original
authority expires, without returning or renewing that authority.
It locks the Intent before its queue entry, pins the prior conversation watermark,
excludes later queued requests from context, and stores one immutable final answer
before releasing the next turn. Dispatch leases cannot be reclaimed while live;
expired work authority blocks that queue. This repository does not authorize workers
or replace Actor Runner's execution lease. Its read-only exchange guard checks the
exact accepted certificate, active workspace, bound run and uncancelled turn. The
dispatcher retains a failed admission for a later same-turn retry; the runner waits
for the outbox binding before acquiring an execution lease. Production background
wiring remains pending integration; the desktop still executes chat
locally. The operations handbook records the isolated real-model proof and its limits.

Task endpoints additionally accept delegated work with a separate signed work
certificate and an execution-bound component grant. They reject mixed identity/work
headers. A delegated change must name the Intent and human contribution accepted
for that turn; it cannot invent its provenance or omit it. Interactive and delegated
requests share the same task repository, validation, idempotency and response format.
The facade exchange checks current access and a live run lease before issuing this
short-lived authority through an opt-in internal HTTP route.

Queue discovery can use signed runtime/component placements from the facade rather
than a saved login. The customer-local discovery query returns bounded turn IDs and
owner scopes, not message contents or work certificates. It skips blocked FIFO
successors and currently claimed dispatches. Placement expiry and the physical
workspace generation/execution switch are checked before discovery. This transport
feeds a supervised worker: one bounded directory page per sweep, at most four
concurrent admissions, interleaved customer queues and owned shutdown. Unavailable
customer databases do not stop the next page; only a directory failure backs off the
whole scan. The real-model journey exercises this loop against signed HTTP discovery,
runner admission, lifecycle coordination and actual database failures. Dispatch uses
a separate pre-lease grant: only a live pending claim can admit its stable run, and
this grant cannot execute tools or read context. Production worker entrypoint wiring,
full tool-host coverage and the native transport switch remain pending, so this is
not yet enabled unattended execution.

The same bounded loop has a separate supervision mode so slow status checks do not
delay delivery. It queries the runner's content-free, placement-authorized status
endpoint for exact admitted runs. Failed, cancelled, unpublished-success or expired
work becomes blocked; unavailable status stays unknown. A saved answer wins a
concurrent block. Supervision never retries effects or renews authority. Intent
renewal controls and native status presentation remain required before activation.

Assistant responses support human up/down feedback with an optional reason. A
`response-feedback` contribution uses the normal append boundary with `text: null`
and a closed payload: `responseId`, `vote` (`up`, `down` or `null`), `reason` (up to
2,000 characters), and nullable `previousFeedbackId`. The target must be an assistant
message in the same owned Intent. Clearing a vote requires an empty reason. Each
change is an immutable contribution; the command ID makes retries idempotent and
the previous-feedback ID prevents overwriting a concurrent change.

A separate, bounded model check infers up/down feedback after input admission.
The saved human message carries `feedbackCheck`: its original Intent, up to six
bounded recent messages with eligible assistant identities, locale and stable command
ID. Routing to a different Intent, or choosing manually after a routing timeout, does
not change that response scope. Automatic annotations carry `inferredFrom` and a
literal `sourceQuote`. The service verifies the owned saved source, eligible target,
command ID, chronology and quote. A draft is not a valid source.

Atomic input admission preserves that same closed `feedbackCheck` contract in the
saved human contribution and binds it into the accepted material digest. The original
response scope is retained when the destination changes. Clients use the admission
receipt's `contributionId`, not its `inputId`, for the later annotation's source.
This persistence support does not move assessment into an unattended worker or enable
the ordinary composer’s background-execution path.

An active response can be captured before it is saved, including an empty first
response. Its scope includes the exact response ID, `pending: true` and the admitted
request ID. Feedback waits for that response to be published; it never substitutes
an older answer. SQL permits this earlier reaction only when the finished response's
`inReplyTo` includes that request and the request was saved before the reaction in
the same owned Intent. Timestamp comparisons remain in PostgreSQL at full precision.
Missing or cancelled targets stay unresolved, rather than becoming neutral votes.

Neutral or manually suppressed checks append a hidden `feedback-assessment`, never a
null vote. Message reads expose `feedbackCheckComplete` using the command's primary
key. The client performs at most two attempts per loaded input; write retries reuse
the assessment rather than calling the model again. Waiting for a pending response
does not hold other checks: reply persistence or history hydration wakes the deferred
save using its existing assessment. Reload can reassess the saved immutable scope.
Unresolved checks remain in the
database and can recover when that history is loaded again. This is not an unattended
server-wide backfill. Closing the client pauses assessment; old contributions without
a captured scope are not retroactively classified.

Automatic votes have no generated reason and are labelled as detected in the UI.
The user can clear them, change direction or add an inline reason. Any such manual
edit, including clearing, prevents subsequent automatic overwrites. A manual save
also wins over an automatic annotation committed since its read; conflicting manual
edits still require reload. Older automatic sources cannot supersede newer ones.

Intent detail and message reads project the latest feedback onto the response.
Annotation events neither displace the recent-message page nor appear as chat text
or search hits. Merge retains the original response and annotations in the source
Intent, following the existing merge relation; it does not relocate their identity.

Conversation-created intents preserve the app's existing lifecycle and response
contract. Artifact and File-skill fields are returned as empty projections until the
standalone Artifact Store integration publishes them through an explicit service API;
the Intent Service does not poll or embed an Artifact Processor.

```sh
bun run --cwd services/intent-service check
bun run --cwd services/intent-service test
bun run --cwd services/intent-service build
```

`bun run test:e2e:platform` performs the database-backed contract check through
the real `api.aven.ceo` facade. It covers idempotent ordered contributions,
stale-version conflicts, update, archive/restore, merge, tombstone, and direct
service authentication failure. The contribution fixture is produced by
in-memory PCM running through the voice VAD, recognizer, speaker embedder, and
semantic state machine, so anonymous speaker persistence is verified without
opening host audio devices.
