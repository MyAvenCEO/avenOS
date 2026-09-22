# Aven Artifact Store

The Artifact Store retains exact documents, derived facts and their evidence so a
person can inspect what an Actor used and safely retry interrupted work. This package
owns immutable contracts, validation, PostgreSQL persistence and the HTTP server. It
does not decode documents, run Actors or choose models.

The deployed customer-data plane routes authenticated access to the selected customer
database. The facade validates client procedures; the remote Actor Runner publishes
through its tenant-scoped route. A caller cannot choose a physical database or publisher.
See the [customer-data boundary](../../docs/customer-database-platform.md) and
[implemented system map](../../docs/customer-database-system-map.md).

## Committed replay and typed retrieval

Publication is atomic and idempotent by publication ID. The scoped publication read
returns its committed receipt and production metadata, including the implementation
identity and execution receipt (such as the selected model); an absent publication returns
`404 RESOURCE_UNAVAILABLE`, while authorization and transport failures remain errors.
The TypeScript client rehydrates output envelopes and exact blob bytes for replay.
This is a successful-production record, not a mutable attempt journal or work lease.
Current inspection uses `core.file-inspection@3`; occurrence-bound matching uses
`reconciliation.match-candidate@2`. The document API validates output versions from
the same schema bindings used by the Actors; it does not accept older output formats
or the obsolete invoice-validation ruleset. Registered definitions are immutable.
The Rust catalog shares those immutable definitions across request-state clones;
browsing does not copy the full catalog into each concurrent HTTP request.
The tenant registry installs each bounded connection pool before opening its first
connection. Simultaneous first reads share that pool instead of competing to create
separate pools under the same database role. Queries still check connectivity and
credentials; the registry does not hold its lock during database I/O.

The scoped artifact collection query selects a type, publication watermark and UUID
cursor, with at most 128 results per page. The first page captures the watermark; later
pages and related type queries reuse it so new publications cannot alter that snapshot.
The query returns immutable envelopes and a continuation cursor, not a claim that all
real-world bank transactions are present. Its current snapshot token has no restore
epoch; clients must restart their query/review session after environment restore.

These reads use the same scoped access boundary as existing artifact reads. Derived
invoice/transaction candidates and human relationship decisions preserve exact input
roles and ordinals. They do not create a bank allocation ledger in this kernel.

`GET /v1/scopes/{scopeId}/artifacts/{artifactId}/references` returns the source
artifact ID and its complete structural reference list, ordered by role and ordinal.
Each edge includes the target artifact ID, target digest and attributes. This is
separate from the artifact envelope and from producer inputs. An existing artifact
with no edges returns an empty list; a missing or inaccessible artifact does not.
Studio uses this resource to verify sealed collection membership after publication
and replay. Publication limits bound the list; the read never silently truncates it.

## Structured queries and quarantined uploads

The library endpoint also exposes a versioned knowledge catalog, bounded AND
predicates (`present`, `eq`, `not-in`), and whole-selection counts or integer-money
sums. The shared Knowledge Actor uses this same projection in chat and Skills.
Missing values do not match exclusions. Currency groups remain separate; reported
receipt amounts are not a verified payable balance. Row cursors and explicit
watermarks include the Store epoch. A saved `knowledge.result` retains its query and
snapshot; row results also retain exact source/representation references. Summaries
do not materialize every member as an edge. These reads neither extract new facts
nor create supplier ownership relationships.
Row responses include the selected collection's schema, so consumers can interpret
declared money fields without guessing from property names. The shared Actor adds
exact typed major-unit values for presentation while retaining original minor units.

An unassigned desktop upload is an `intake.upload`, not a `core.file`. The inbox
lists only metadata. Its bytes cannot be read through the content endpoint, and it
cannot be a run input, structural-reference target, or source-blob authority for
ordinary publications. The authenticated API service can publish `intake.promote@1`
after explicit placement: one admitted file and its Intent declaration, with the
original upload as a causal input. The scope admission lock serializes competing
promotions. Identical replay returns the same result; another target conflicts.
The original remains quarantined even after promotion. This does not scan files for
malware or promise that admitted content is trustworthy.

The queue is a live, paged view, not a historical snapshot. Automatic routing,
quarantined OCR, background model inspection and inferred admission are not enabled.

## Contracts and verification

The built-in catalog includes closed HTTP request/response and IMAP query, selection,
read-result and raw-message shapes. Raw mail requires an unchanged `message/rfc822`
blob; it is not a generic document with guessed extracted headers. The shared
TypeScript run publisher is used by Studio and the protected connection adapter.
Protocol-specific validation also checks coverage, exact selection and trusted
publication provenance; structural JSON validation alone does not establish these
facts. These types and isolated real-service proofs do not yet enable customer-facing
mail or authenticated HTTP Actors. MIME interpretation remains a separate pending step.

The release image uses Rust 1.98.0 and PostgreSQL 18. The
[normative contracts](artifact-store-spec/README.md) define publication and evidence.
The [build and test handbook](../../docs/operations/build-and-test.md) owns verification
commands and the complete native/customer-database E2E gate; the
[local stack guide](../../docs/operations/local-stack.md) owns local operation.

## Evidence bounds

The [artifact library](../../docs/artifact-library.md) uses scoped, publication-bound
read projections and schema version 4 indexes. Its document and financial rows do not
rewrite stored artifacts or create supplier/entity records.

Publication validates evidence against the exact input and output artifacts. Byte
ranges must fit the primary blob; JSON pointers must use RFC 6901 escapes and resolve
to an existing payload value. Invalid locators return `422 INVALID_EVIDENCE`. Page
regions remain bounded geometric claims; the store does not decode source documents
to verify their visual contents. Replay continues to ignore expired upload authority
because it creates no new artifact.

Document uploads default to 128 MiB, with 512 MiB of staged uploads per scope and a
1 GiB logical storage quota. Deployment overrides can lower these bounds. The facade
and native client enforce the same per-file limit. Version 3 statement candidates and
invoice details allow 16 MiB of canonical payload for merged financial chunks; other
types retain the 256 KiB payload ceiling. Per-artifact schema bounds remain enforced.

Each workspace permits 32 live upload reservations, independent of the byte limit;
the service also limits concurrent upload requests to two. Both return HTTP 429,
with details distinguishing busy admission from unfinished-upload capacity. The API
preserves that status. API, document, and Studio publishers share one stable claim
identity per scope, publication, and output, so retries do not allocate new slots.
An expired or consumed claim can only finish through exact committed-publication
replay; it never authorizes a new publication. An uncommitted reservation expires
after 24 hours. Failed publications do not release it early because the commit may
have succeeded while its response was lost.

Context, upload, and publication check the workspace's installed type digests against
the running catalog. Missing or changed definitions return HTTP 503
`STORE_RECONCILIATION_REQUIRED` before staging bytes. This is a readiness check, not
an old-format adapter or runtime schema installer. The provisioning role owns catalog
installation; restarting a service alone does not update an existing workspace.
