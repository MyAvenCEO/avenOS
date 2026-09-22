# Protected connection executors

These host-only factories read an admitted HTTP resource or selected mailbox without
giving an Actor the credential. They are exercised against actual PostgreSQL, TLS
servers and Qwen. A startable fixed-protocol host and optional installed Skill Actors
exist. An isolated local deployment proves native settings and review denial;
positive remote use is covered by the combined real-server Studio proof. Hosted
deployment and operator key escrow remain separate release gates.

HTTP performs one bounded, DNS-pinned HTTPS exchange. Redirects are observations,
not automatic follow-up requests. IMAP uses the pinned ImapFlow client with implicit
TLS, read-only EXAMINE and BODY.PEEK. Queries capture a UIDNEXT fence and scan bounded
numeric windows; reading requires a selected account/mailbox/epoch/UID. Incomplete
coverage remains explicit. Each actual protocol command passes a closed command gate
and a new durable SQL claim. Unknown commands, revoked bindings, ended authority,
exceeded budgets and interrupted connections fail closed.

`withCredentialExecution` owns the interval from the first successful claim through
protocol shutdown and publication. Only the winning handler receives the ownership
callback. Its final settlement removes that use's UUID from the physical execution
markers, independently of the parent Actor run. A lost claim acknowledgement or process
crash leaves the marker for reconciliation; expiry and request replay never release it.
The protected host must wrap the entire capture/publication body, not just the network
call. Both protocol factories finish closing their connection before returning.

The host supplies verified use authority, current identity/parent checks, exact stored
request lookup, credential-use pools and an unsealer. Only the protected process may
receive these ports. Optional observations carry fixed stage/command names and ordinals,
never command arguments or provider errors. The IMAP gate uses ImapFlow's internal
`exec` boundary: upgrading its pinned version requires a wire audit and real-server
tests, not just a package update.

The host-only `ConnectionArtifacts` adapter resolves exact stored requests and mailbox
selections. It checks scope, type, digest, source edges and the Store-authenticated
publisher of query observations. Results use the shared immutable run publisher:
HTTP bodies remain response blobs; a captured mail publishes an unchanged
`mail.message` plus its referring read result. Continuations retain the previous
selection and verify the covered UID interval. Unknown use outcomes do not fabricate
results. A publication retry uses the same invocation identity and exact observation;
it does not authorize another network exchange. The host must recheck current authority
after blob staging and before commit.

Real-Qwen component proofs now include the Rust Store and byte-exact publication
replay. They do not prove production policy or tenant-scoped Store credentials.
The API's `ConnectionPolicy` rebuilds a review subject from current artifacts,
bindings and credentials, then binds approved use to the current session and run
lease. Its identity-bound adapters obtain fresh component grants, follow operator
placement, read the runner's live admitted invocation and reload the private review.
The private prepare/issue and executor-only verify routes have distinct workload
credentials. The real management proof exercises those adapters through an actual
SQL runner and human review; it does not establish deployment isolation.

`runtime.ts` composes protocol-specific SQL access, the current-policy check and
protected Store publication. `index.ts` admits one configured protocol and drains
active uses before closing its pools. Ordinary Skill Actors retain only exact result
references; the shared Studio publisher records membership without copying raw
observations under its own identity. The shared review card shows destination,
operation, selection and byte limit. Separate ordinary Actors inspect saved UTF-8
HTTP data and decode bounded mail parts; they never receive executor credentials.
Unattended Sources and hosted deployment qualification remain outstanding.
There is no generic secret-read endpoint.
See [HTTP boundaries](../../docs/http-resource-actors.md),
[mail provenance](../../docs/imap-mailbox-actors.md) and
[qualification commands](../../docs/operations/build-and-test.md).
