# `@avenos/http-resources`

This package is the first implementation slice of the artifact-first HTTP resource
pipeline. It keeps public request artifacts separate from credentials and gives a
trusted server host the bounded ports needed to acquire one web representation.

The implemented contracts currently provide:

- normalized `GET` and `HEAD` request values with no body or secret-bearing headers;
- exact customer, subject, session, placement, method, purpose, host, port, and path
  matching for Vault bindings;
- distinct set-only administration and session-use interfaces, including typed
  header, cookie, and query attachment rules;
- private response-index lookup before network I/O, partitioned by customer,
  principal, execution placement/scope, credential and binding versions, policy
  revision, purpose, method, URL and representation headers;
- current request and artifact-access checks for cached/offline selection as well
  as network reads; rotation, revision changes and revocation during lookup fail
  before cached content is released;
- ETag revalidation, with Last-Modified only as a fallback;
- a bounded HTTP/TLS transport which validates and pins DNS answers, verifies the
  original host's certificate, and supports cancellation and a total deadline;
- manual redirect traversal; credentialed origin changes stop with an explicit
  reason, while permitted same-origin hops recheck the binding;
- bounded retained response metadata which excludes cookies and authentication
  challenges; and
- a host result which either selects an existing response, streams a new body, or
  reuses a previously committed body after `304 Not Modified`.

An offline selection is explicitly labelled `offline-cache`, with the original
capture time, selection time and freshness assessment. It does not assert a new
observation or turn stale data into a current result.

`httpResponseDiagnostic` supplies bounded protocol meaning beside a captured result.
Successful capture is not the same as a successful application result. A `404` does
not prove that underlying data is absent; a no-content or partial-content response
does not establish a zero count or complete collection. This helper interprets the
status only, not the response body, and grants no retry or credential authority.
Hosts should also say whether a failed materialization released any body to its
consumer, rather than conflating received network bytes with usable evidence.

The transport admits public addresses at host-configured origins only. Loopback
exceptions are explicit host test configuration, never request options. It rejects
compressed, oversized and incomplete bodies; it does not retry or follow redirects
itself. Header and known secret-query-name rejection reduces accidental disclosure;
it cannot prove that arbitrary remote content or URL values contain no secrets.

This is not an enabled credential feature. The package does not yet publish Artifact
Store blobs, register the HTTP Actor factory, persist Vault records or enforce the
protected executor and per-use authority boundary. The memory Vault is only a fixture;
the host access port still needs a durable policy and artifact-access implementation.
Its policy revision must cover both credential-use and response-release policy.
The memory Vault pins binding/secret versions and checks them synchronously at use;
this is not a durable use claim or authorization service. Live identity proof remains ephemeral in Runner.
The [HTTP design](../../docs/http-resource-actors.md) owns those implementation gates;
[IMAP](../../docs/imap-mailbox-actors.md) shares the credential boundary, not this transport.

Run its contract and loopback-server tests from this directory:

```sh
bun run check
bun run test
```

The loopback tests perform real HTTP/TLS exchanges and check address/redirect limits,
byte identity, ETag/`304` reuse, cancellation, and retained metadata. They do not prove
productive authorization or cache publication. The index must match the supplied
private cache key; `Vary: *` and `no-store` entries are not automatically reused.
All accepted public request headers participate in the key, which is conservative
rather than a selective `Vary` optimization. The tests also do not prove
secrecy against a remote provider that encodes a credential into its response. The
full platform E2E must additionally prove facade admission, customer-database
isolation, set-only Vault routes, Actor Runner execution, Artifact Store publication,
materialization, and planner reuse before the feature is considered complete.
