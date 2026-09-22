# Intent admission

A message becomes part of an Intent only after the server accepts its destination
and saves an admission receipt. This package owns the shared input and receipt
schemas used by the API and Intent Service. The native admission path is still being
integrated; the contracts alone do not move existing desktop execution to the server.

An input has a stable ID and an editable revision before admission. Once accepted,
that ID identifies exactly one contribution and turn. Retrying the accepted revision
returns its receipt; different words, destination or revision conflict. A later
correction is a new contribution, not a rewrite of accepted history.

`admissionDigest` validates and canonicalizes the complete input before hashing it.
It uses Web Crypto, not a server-only dependency. Unknown authority fields, invalid
language tags and unrecognized timezones are rejected. The material contains bounded
screen references, not executable instructions or credentials.

The private pending-input capture keeps a bounded display excerpt, exact saved
artifact/Case/draft-revision references and the device timezone from submission.
The composer restores that capture rather than reading whichever screen is now
selected. The admission builder forwards only the typed identities and timezone;
it never forwards the display prompt. An uncaptured recovered draft must be reviewed
and resubmitted before durable admission. Unsaved editor content is not a saved
revision; its handoff remains a gate before switching ordinary Studio chat to the
background host.

An optional `feedbackCheck` carries the original response scope through that same
admission. Its bounded recent messages, pending-response/request pair and stable
assessment ID are part of the material digest; replay cannot replace them. The scope
is saved on the human contribution for delayed assessment, not inserted as model
evidence or treated as a vote. Feedback must reference the returned contribution ID,
which is distinct from the local input ID. Moving the new message to another Intent
does not move the captured feedback target. Manual feedback still takes precedence.

Persistence, owner checks, target-state checks and outbox delivery belong to Intent
Service. Authentication and signing belong to the facade. See the
[customer-data system map](../../docs/customer-database-system-map.md) and the
[build and test handbook](../../docs/operations/build-and-test.md) for current limits
and validation.

`RemoteIntentWork` is the shared client for admission, receipt lookup, paged status
and exact-turn cancellation. It validates both requests and response identities. It
does not retry writes or choose a new input ID when the acknowledgement is missing;
the caller must retain the original input and inspect its receipt. Only the typed
not-found receipt response means no admission was found. Denials and connection
failures remain errors.

Queue status exposes the reserved `responseId` from admission onward. It is the
future reply's identity, not a saved response or an execution grant.
`outputContributionId` remains null until publication. Pending feedback can bind
that response ID to its exact `contributionId` request while waiting for publication;
it must not target the previous answer. Runner identities and work credentials
remain outside this queue projection.

The native bridge captures an opaque customer-workspace scope, accepts only these
fixed operations and reuses the existing authenticated Intent transport. A scope
change before a request rejects it; a scope change during the request withholds the
result without claiming the operation did not happen. The ordinary desktop composer
has not yet switched to this background-work path. Its editor, permission renewal,
status rendering and combined native journey remain qualification gates.
