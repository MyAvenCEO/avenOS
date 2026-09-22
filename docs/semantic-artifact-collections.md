# Semantic collections, observations, and document intake

Status: proposal with a bounded first implementation; not a claim that the full design
or its verification is complete.

The current slice adds typed computation, a schema-first read projection over existing
document/financial observations, and a metadata-only upload inbox with explicit
Intent admission. Chat and Skills share the same query Actor; the library uses the
same Store query. Missing-value-aware exclusions and currency-separated aggregates
are implemented. Arbitrary relation definitions, entity resolution, automatic
backfills, live-query subscriptions and inferred intake placement remain proposed.
Query previews name the measured collection and distinguish a document inventory from
inspected source contents or extracted values. The shared query Actor accepts a bounded
`purpose` describing the intended check; it is retained with the query, not sent as a
Store filter or presented as proof that the user's broader goal has been completed.
The [system map](customer-database-system-map.md) owns implemented boundaries and the
[test handbook](operations/build-and-test.md) owns reproducible verification.

## Purpose and decision

A person should be able to ask what information their workspace contains, work with
one real example, and turn that work into a Skill over similar cases. They should not
need artifact IDs, repeated document reading, or knowledge of the processing pipeline.

Add one shared semantic read model over immutable artifacts. It describes subjects,
their typed observations, and collections selected by predicates. Chat, the library,
the solver, and Studio use this model. Execution still binds exact artifacts and
retains evidence. Observations do not mutate their source documents.

The motivating selection is **incoming documents that have a destination which is
not Berlin or Munich**, not documents for which no Berlin/Munich match was found.
Missing, ambiguous, or conflicting destinations do not satisfy that condition.
For documents with multiple journeys, select the qualifying occurrences and retain
their source documents; do not pair an arbitrary location with an unrelated date.

This proposal also covers current document revisions, scoped uploads, grouped intake
review, schema-based presentation, entity relationships, and query-triggered Skills. These share subject
identity, provenance, and current-state selection; separate implementations would
produce inconsistent answers and duplicate automation.

There is no previous-version compatibility requirement. Introduce closed new
contracts and remove replaced execution paths when their replacements are proven.
This is not permission to reset a running customer database. Development-data reset
is a separate, explicit operational action.

## Evidence and existing foundations

A read-only inspection of the local customer database on 18 September 2026 found:

- The newest document-research Intent correctly opened and asked for scope.
- Its subsequent document-kind question used eleven calls: a search, two failed
  research-record calls, seven document reads, and a successful research record.
  One failure required a source quotation although the question was an inventory.
- The travel inquiry needed destination roles, not all addresses in travel receipts.
- The Store already held document classifications and structured invoice results.
  A per-document full-text workflow was unnecessary for discovering those schemas
  and reporting the classifications already available.

A later read-only review of the newest contributions found an additional boundary:
an arithmetically correct answer claimed computation checks absent from its complete
saved tool list, while a money-summing tool's minor-unit result was described in major
units and its currency field was reused for token quantities. The
[knowledge-maintenance proposal](semantic-knowledge-maintenance.md#evidence-used-in-this-revision)
records the anonymized cases and separates these findings from uninvestigated provider
timeouts. Derived values need both unit semantics and actual computation receipts.

The [library](artifact-library.md) has scoped, snapshot-paged SQL projections, including
specialized selection of financial representations. The Store has immutable artifacts,
production inputs, field evidence, structural references, and a publication feed.
Markdown patching creates a derived immutable file, but not a general authoritative
document head. Studio supports typed ports and exact execution bindings; its existing
arrival connections are type-based and synchronize through an authenticated session.
Untargeted window drops now enter the quarantined inbox. Explicit Intent targets
admit to that Intent; inbox review can promote a batch to one existing or new Intent.
Every original remains linked and is restored on reload, with aggregate processing
status that does not hide files still running or needing review.
The current attachment Actor resolves the original upload declaration, not a general
current Intent association. None of these foundations alone provides this proposal.

The [enrichment paper](artifact-first-semantic-enrichment.md) currently specifies an
exhaustive default without an effort budget. This proposal would replace that default
with bounded baseline enrichment plus demand-driven enrichment. Exhaustive exploration
may remain an explicitly selected, bounded mode. Acceptance must update that paper and
the [planner contract](actor-skills-and-problem-solving.md) together; it must not add a
second planner or silently change the meaning of saturation.

## Invariants

1. An observation records a claim, not unquestionable truth. Schema validity,
   extraction confidence, arithmetic validation, and human approval remain distinct.
2. Every selected value has a subject and semantic role. Causal ancestry is not a
   substitute for identifying what a value describes.
3. Missing evidence is not evidence of absence. Only proven matches enter a matching
   collection; uncertainty remains inspectable.
4. Read-only description, inventory, query, sample, and explanation never invoke an
   extractor, write artifacts, or start business actions.
5. Every productive run freezes its inputs, policy, query version, evaluation time,
   and evidence references. Later arrivals cannot change a running input set.
6. A derived artifact does not replace its source unless an explicit revision
   operation establishes that relationship.
7. User-selected upload placement outranks inferred routing. Content is untrusted
   data, not authority to route, publish, or execute.
8. Counts, samples, evidence, caches, subscriptions, and derived outputs obey the same
   customer and authorization boundaries as their underlying sources.

## One semantic contract, three layers

### Immutable domain artifacts remain the source of record

Keep cohesive outputs such as invoice details or a travel extraction together. Do
not create an artifact for every scalar or copy every existing field into a second
authoritative fact database. Correcting an extraction publishes a new observation or
decision with its inputs; old evidence remains available.

Extend the registered type contract with a bounded, versioned semantic descriptor.
It declares subject bindings, property IDs, value schemas, field paths, occurrence
groups, evidence paths, and presentation hints. This is shared metadata used by the
Store projector, Actor contracts, query compiler, solver, and UI, not another catalog.
Start with declarative paths and bounded array expansion. Unsupported transformations
must be explicit normalizer Actors, not executable code embedded in a schema.

New extractors may emit domain records or a schema-bound observation set. Both follow
the same descriptor contract. Existing domain types are brought into that contract
directly; this is not an adapter that preserves obsolete APIs. Arbitrary LLM JSON is
not automatically a reusable fact family: it must pass an installed output contract,
subject binding, and evidence validation first.

### Subjects distinguish files, document units, and occurrences

A file can contain multiple document units; a unit can describe several events or
line items. A subject reference identifies the logical subject and the exact source
revision, with an occurrence identifier where needed. Evidence also names the exact
extraction artifact and field locator. Query results preserve these distinctions.

For a travel segment, destination, departure, and date belong to one occurrence.
Matching returns that occurrence, its supporting observation bundle, and its original
document. A caller can explicitly request distinct documents instead. Counts must say
whether they count files, document units, or occurrences.

Subject IDs are opaque identities, not filenames, translated labels, or hashes of all
current values. Repeated extraction of an unchanged subject reuses established identity.
An extractor must not treat array position as stable identity across resegmentation.
If correspondence cannot be established, mark identity unresolved and require an
explicit reconciliation before repeating automatic effects. Duplicate imports and
two documents describing the same business event are not automatically one subject.
Party identities and typed relationship assertions use these same foundations.
Cross-document matching is a later explicit operation over those assertions, not a
hidden join or automatic entity merge. The contracts must accommodate it from the start.

### Searchable projections are derived and rebuildable

Project typed values, subject membership, accepted interpretations, current heads,
and coverage into indexed customer-scoped tables. Every row points back to immutable
evidence. The projection is not edited independently. Its generation and publication
watermark establish which data a query has actually seen. Mutable current-state
projections must retain validity intervals or an equivalent bounded snapshot mechanism
for paged reads. A cursor pinned to yesterday's watermark cannot query today's heads
and still claim to represent yesterday. Expired snapshots require an explicit refresh.

An observation carries, directly or through its producing artifact:

- Subject, semantic property, typed value, and original lexical form when applicable.
- Evidence locations and the exact source/extraction revision.
- Producer, configuration/model receipt, and observation time.
- Valid time when the assertion describes a time-dependent state.
- Coverage, validation findings, and uncertainty with reasons.

Policy selects supported interpretations; a recorded human decision can resolve or
reject candidates. Newer extraction does not automatically defeat earlier confirmed
evidence. Unresolved disagreement yields a conflict, not last-write-wins. A change to
the source revision invalidates automatic reuse of its former field observations
unless an explicit derivation establishes their continued applicability.

## Property and value vocabulary

Keep property meaning separate from value representation. `invoice.issueDate` and
`travel.departureDate` can share a date value schema but cannot satisfy each other's
requirements. Stable, namespaced property IDs have localized labels and descriptions.
Published schema and descriptor versions are immutable and pinned by consumers;
changed meanings require an explicit new contract, not reinterpretation by label.

| Value family | Required semantics |
| --- | --- |
| Date and time | Date-only versus instant versus local date-time; precision, zone if known, ambiguity, and source text. Never invent midnight or a timezone. |
| Money and quantities | Exact decimal representation, currency or unit, scale rules, and sign. No floating-point totals or implicit currency conversion. |
| Place and postal address | Mention versus resolved identity; country and address components where known. No globally mandatory postcode/state layout. |
| Identifier | Scheme, issuer/jurisdiction where relevant, lexical value, permitted normalization, and separate validation results. IBAN, BIC, VAT ID, LEI, email, ISBN and EAN/GTIN are not interchangeable strings. |
| Classification | Stable concept IDs, taxonomy version, multiple applicable labels, alternatives, and assessment. A financial label is not an exhaustive description of a document. |

Use one shared, small value-schema library. Implement dates, money, classifications,
role-qualified places, and the identifier contract with an IBAN validator in the first
slice. Additional scheme validators register through that same contract without
changing query or port semantics. Unknown schemes remain inspectable but explicitly
unvalidated. A syntactically valid identifier is not proof that its owner or referenced
item exists.

Detect language and number/date notation when necessary, at document and field level.
Preserve raw strings and parsing assumptions. Document language alone does not settle
`03/04/2026` or mixed decimal formats. Rendering follows the user's locale; parsing
follows source evidence. Ambiguous values retain candidates and remain unknown for
comparisons that require a resolved value. Do not normalize all addresses into a city
string or compare places solely through translated spelling.

### Derived values and computation receipts

**First implemented slice:** the shared calculation Actor now provides bounded exact
decimal add/subtract/multiply/divide/compare/round operations, explicit units,
inspectable chat results and `values.calculation@1` Skill artifacts. This is not the
full computation-expression or semantic query design below. Compound units,
arbitrary expression trees, per-operand semantic assertions and automatic extraction
planning remain proposed. Skill input ports retain causal provenance; direct chat
arithmetic retains a tool trace, not a separate Store execution receipt.

Use an installed pure calculation Actor for both chat and Skills, replacing the
chat-only simple-sum path. Its bounded expression contract covers add, subtract,
multiply, divide, compare and explicit rounding over decimal-string values and named
units. Unknowns, currencies, quantities, scales and precision cannot be inferred from
a bare number or a three-letter label. A derived result retains the expression,
operand evidence, unit/rounding contract and actual Actor execution receipt.

User-supplied arithmetic binds to that contribution rather than requiring a document
quotation. An empty research record or a correct-looking answer is not proof that a
calculation ran. Financial reconciliation remains a domain operation, not a generic
sum interpreted as payment or debt. The selected limits and proof requirements are
in [typed computation and execution proof](semantic-knowledge-maintenance.md#typed-computation-and-execution-proof).

### Identifiers and other specialized values

An identifier value retains the scheme and its contract version, original text, any
canonical representation, issuer/jurisdiction context when needed, and evidence.
Validation records belong to the observation/result, not to the spelling of a value:
two occurrences of the same value can have different supporting evidence and checks.
Store identifiers as strings; never apply locale-number parsing or lose leading zeros.
Equality is scheme-defined and includes the relevant issuer namespace. Two suppliers'
invoice number `000123` does not identify one invoice.

| Family | Initial contract and extension requirement |
| --- | --- |
| Bank/payment identifiers | IBAN country-format and check-digit validation; BIC and national routing/account schemes as separate registered validators. Keep payment reference, account holder claim and bank identifier separate. |
| Organization/tax identifiers | Country/scheme-qualified VAT and tax IDs, LEI, company registration IDs. Directory status is a dated observation, not permanent identity validation. |
| Product/publication identifiers | GTIN/EAN/UPC and ISBN with scheme-specific checks and normalization. Preserve original encoding and only declare cross-format equivalence where the scheme defines it. |
| Contact identifiers | Email, telephone and URLs with scheme-specific normalization and contextual requirements. Valid syntax does not establish deliverability, ownership, or permission to contact/fetch. |
| Local business references | Invoice/order/customer numbers and booking references qualified by issuer or system. No global uniqueness assumption or automatic entity merge. |
| Partial/redacted values | Explicit partial-value type and known fragments. A card suffix or masked account is not a full identifier and cannot establish equality with one. |

For IBAN, use a pinned edition of the national-format registry and a tested checksum
implementation, not an LLM's judgment or one loose regular expression. Swift is the
registration authority and publishes the country-specific formats in its
[IBAN registry](https://www.swift.com/standards/data-standards/iban-international-bank-account-number).
Record the ruleset version used by each validation. An unsupported country/edition
must be distinguishable from a value proven invalid under supported rules.

For GTIN, implement normalization against the chosen GS1 contract; GS1 documents
zero-padding shorter encodings for a common fourteen-character representation in its
[trade-item-number guidance](https://www.gs1.org/edi-xml/technical-user-guide/Item_Numbers).
Retain the original representation as well. This is why generic numeric conversion
or an unconditional trim-leading-zeroes helper is wrong for identifier values.

Checks are independent, not a single `verified` flag or an assumed trust ladder:

- Recognized/extracted: a candidate of the stated scheme was found at this source location.
- Format/checksum: deterministic local checks passed, failed, were unsupported, or were
  not performed. A failed candidate is retained, not silently dropped from the evidence.
- Registry/directory: an authorized external lookup returned a result at a stated time,
  with source, coverage and freshness. It is a separate Actor invocation and artifact.
- Subject relationship: evidence supports that this identifier belongs to, is stated
  by, or is designated for a particular subject and role.
- Action authorization: a person or policy approved this value for the particular use.

Passing one check does not imply the others. An IBAN's valid format/checksum is not
proof of account existence, account ownership, current usability, or permission to pay.
For example, `invoice.requestedPayeeAccount`, `payment.debitedAccount`, and an independently
confirmed beneficiary account have different property meanings even when all use IBAN.
A newly extracted payment instruction must not overwrite a confirmed beneficiary.
Changed payment details become a reviewable difference, not an automatic payment update.

Normalization is a deterministic registered operation with input/output contracts,
not an excuse to repair evidence. Preserve every transformation. OCR confusions such
as `O`/`0` or `I`/`1` may produce explicit correction candidates; do not silently choose
characters merely to make a checksum pass. User confirmation produces a new decision.
Scheme rules, not document language or UI locale, govern normalization; do not apply
one case-folding, punctuation-removal or Unicode-replacement rule to every identifier.

The solver distinguishes finding a candidate, normalizing it, validating it and
resolving its subject relationship. These are reusable Actor contracts backed by the
shared deterministic value library where possible. Only extraction requiring language
or vision understanding uses the model. Queries may require particular check results;
an extraction confidence score cannot satisfy a checksum or ownership requirement.

Use grouped, readable display and explicit reveal/copy for sensitive identifiers.
Mask account details in overview cards and default prompt samples; do not place raw
values in telemetry or public errors. Authorized exact operations can request full
values. Masking is presentation, not authorization or a substitute for access control.
Inspection and offline validation must not send identifiers to third-party validators.
External resolution needs explicit permission and a narrowly scoped installed Actor.

Reference-data updates are reviewed/versioned inputs. They publish new validation
results or rebuild a versioned projection; they do not rewrite past receipts. Prefer
maintained standards-based libraries plus official test vectors over hand-written
validators. Supporting a new scheme requires normalization/equality rules, validation
states, limits, sensitivity/rendering metadata and tests, not a new Studio screen.

## Entity relationships and reusable matching knowledge

Remembering that an email, address or IBAN is associated with a supplier should let
the system recognize that relationship in later material and revisit earlier material.
That knowledge belongs in the customer database, not only in a model prompt or a chat
summary. Matching is an inspectable derivation over stored assertions and observations.

The subject/predicate/object distinction is useful here; it is the basic structure
described by [RDF Concepts](https://www.w3.org/TR/rdf11-concepts/#section-triples).
Use that conceptual separation without requiring an RDF database, SPARQL, or unrestricted
ontology reasoning. Our assertions additionally need evidence, assessment, temporal
scope and lifecycle decisions. Future export can map them to graph representations;
plain triples alone would not preserve their complete meaning.

The companion [knowledge-maintenance implementation proposal](semantic-knowledge-maintenance.md)
details how newly described relationships can be applied to old and new data. It
separates meaning, executable recipes and activation, and specifies lazy evaluation,
materialization, support invalidation, unattended authority and remaining design gates.
Its researched revision selects a closed descriptor/rule profile, Store-side semantic
admission, shared query/materialization evaluation, committed-watermark backfill and
Store-fenced publication. These are implementation decisions, not completed features.

### Separate parties, values, assertions and matches

- **Party:** a stable customer-scoped identity for a person or organization. Names are
  attributes, not identity. Profiles are views over its supported observations.
- **Typed value:** an address, email or account identifier under the value contract.
  Equal normalized values can be indexed together without creating one party for them.
- **Relationship assertion:** an immutable claim connecting a subject to another
  subject or typed value, under a named relation with declared endpoint schemas.
- **Derived match:** an immutable inference that records which observations, assertions
  and versioned matching rule support a particular association, and its assessment.

Do not make a globally interned entity for every literal. Use typed value objects for
ordinary matching; introduce an address/location/account subject only when it needs
its own relationships or lifecycle. Preserve the observations of that value separately
from the value itself. Matching an IBAN string does not prove the observed document is
authentic or that the supplier currently owns the account.

"Supplier" is a relationship to a buyer/person/organization, not an intrinsic universal
type. One customer environment may contain several businesses, and the same party may
be both supplier and customer. Resolve "my suppliers" to the relevant buyer context;
ask if that context is materially ambiguous. Initial relation names should distinguish
`supplierOf`, `hasPostalAddress`, `usesContactEmail`, `designatesPaymentAccount`, and
document-specific `issuedBy`. These are proposed semantic names, not existing APIs.
Avoid a generic `belongsTo` relation that silently conflates ownership, use, location
and payment designation. Predicates have explicit direction; inverse views are declared,
not inferred by treating all relationships as symmetric or transitive.

An assertion records subject, predicate, typed object or entity reference, applicable
role/context, supporting evidence, assertion origin, recorded time, and valid time or
explicitly unknown validity. Acceptance/rejection/retraction is a separate recorded
decision; an agent-origin claim never becomes human-origin because a policy accepts it.
Relation descriptors reuse the semantic contract and specify allowed subject/object
families, multiplicity, sensitivity and available validators. Multiple addresses or
parties sharing one address are valid; do not impose uniqueness from value equality.

Use ordinary typed assertion, inference and decision artifacts with exact references
to their inputs. Do not repurpose the Store's structural-reference table as a mutable
knowledge graph. During implementation, reconcile the existing `contact.party` and
`brain.assertion` catalog sketches into this contract instead of adding a second party
directory or preserving their broad `belongs-to`/`same-as` meanings as compatibility.

### Learning through conversation and extraction

When the user says "This email address belongs to supplier Northwind," resolve the
selected value and party, then record the narrow assertion with the exact conversation
contribution as evidence. The writer must verify the authenticated human contribution
and its scope; quoting a purported user instruction inside a PDF grants no authority.
An unambiguous instruction can be applied directly with a visible receipt and undo.
Ask only when identity, relationship role, temporal scope or requested effect is unclear.
Do not make the user specify the whole schema for an ordinary association.

An extractor or agent can also propose the relationship from evidence. It remains
inferred, with a rule/model receipt and the applicable support policy. A reviewed policy
may accept low-risk exact associations automatically; ambiguous or conflicting cases
enter the same grouped review queue. The system need not ask for confirmation of every
match, but it must not equate high model confidence with human confirmation.

Confirmation of a relationship is not permission to use it for every downstream action.
Recognizing an address, filing a document, updating a supplier profile, and preparing
or executing a payment have different admission policies. A confirmed payment-account
association is not blanket authorization to transfer money.

### A bounded matching rule, not equality propagation

For example, the user confirms that Northwind uses address A and is a supplier of
buyer B. A later document contains an address observation equal to A under the recorded
address-normalization rules. A matcher can derive that the document **mentions an
address associated with a known supplier** and return Northwind as that association.
The same derivation applies to already observed historical documents within its scope.

It cannot thereby conclude that Northwind issued the document: the address might be
the delivery recipient, an accountant, or a shared office. Deriving `issuedBy` requires
an issuer-role observation and sufficient disambiguating evidence under that rule.
Likewise an email address copied on a message is not automatically the sender, and a
payment processor's shared IBAN does not uniquely identify an invoice's supplier.

Initially support deterministic exact scheme-normalized matching against accepted
assertions, with role, context and temporal checks. Matching can return several parties
or unknown; no "first result wins." Fuzzy address/name matching may generate candidates
later, but cannot silently merge identities or promote a candidate to an accepted link.
Absence of another candidate in the local database does not prove global uniqueness.

Implement one installed executor for bounded positive declarative matching rules with
explicit prerequisites/output contracts, not a new executable Actor for each relation.
Reuse the shared Actor runtime, solver,
query descriptors and evidence publication. Do not introduce a separate agent-only
reasoner. Rules cannot recursively use their own conclusions as independent evidence;
the initial dependency graph is acyclic, depth/fan-out bounded, and terminates with an
explicit budget/coverage result. Independently supported alternative derivations remain
separate, so retracting one support does not erase another valid reason for the match.

### Time, corrections, backfill and subscription effects

Record when a relationship was learned separately from when it held. Learning an
address today does not establish that it belonged to that supplier five years ago.
If validity is unknown, historical matching may suggest an association but cannot
silently claim historical ownership. Ask for a date range only when required by the
requested conclusion or action. Current-role queries and event-time-role queries are
different: an old document can mention a party that is one of the user's suppliers now
without proving the party was already their supplier when that document was created.

When an assertion is added, corrected, rejected or retracted, reevaluate dependent
matches. Dependencies include exact assertion/decision IDs, rule/normalizer versions,
source observations and evaluation time. A rejected candidate needs a scoped negative
decision so it is not proposed again with identical support; new material evidence may
justify a new review. Do not convert rejection of one match into a global "not a supplier."

Current projections must stop presenting unsupported derived matches as accepted,
including while asynchronous recomputation is pending. Historical runs keep their
original evidence and are marked affected where appropriate; never rewrite their
inputs or pretend an earlier action did not happen. An explicit entity merge/split is
a later reviewed decision over identities, not deletion or transitive `same-as` inference.

Use reverse indexes from scheme/canonical value, party and assertion IDs to affected
observations/matches. This permits batched reevaluation without rereading every source
document or running an LLM on every join. A newly learned association should schedule
an idempotent, checkpointed backfill of already extracted data under a captured
watermark, then continue with new arrivals. Missing extractions remain visible and
require separately admitted enrichment; background matching is not hidden OCR work.
Large backfills expose progress, cancellation and resumability, not a claim of instant
complete recognition. Freshness/coverage applies to relationship projections too.

Distinguish **backfilling knowledge** from **replaying business actions**. Historical
matches become searchable and can update a report under its approved maintenance policy.
They do not automatically send old messages, make payments, reroute old Intents, or
rerun every Skill. Subscription events retain source-admission and knowledge-change
origins; each subscription explicitly chooses future-intake, newly understood existing
items, or reviewed historical backfill. Retry and projection rebuild preserve delivery
identity so an old match does not become another new arrival.

### Query, UI and delivery implications

Allow bounded declared paths such as "documents mentioning addresses of suppliers of
buyer B" and "invoices issued by my suppliers." They use the same saved-query model,
including unknown/conflicted matches and exact explanations; they are not synonyms.
Authorization applies to every observation, relation and entity in the path. A private
supplier relationship cannot leak through a count, candidate, or derived public report.

Present compact party links with their roles and assessment, plus an expandable reason:
the observed value, the user's assertion or other support, and the matching rule.
Allow confirm, correct, reject, and narrow application to this occurrence or a reusable
relationship. Show backfill progress and affected-result counts. Neither humans nor
agents need a graph editor; agents inspect and change the same typed assertions and
decisions through authorized Actors, with the same previews and concurrency checks.

Reserve entity references, relation descriptors, exact support references and temporal
scope in the first contracts. Ship deterministic supplier matching and its historical
backfill as a later vertical slice. Keep fuzzy matching, general entity merging and
arbitrary recursive inference outside that slice. This preserves the extension path
without making the first inventory implementation depend on a complete knowledge graph.

## Collections and query semantics

A saved collection is an immutable, versioned query artifact with a human-readable
name. A query names scope, subject family, required properties, relationship bindings,
conditions, selected fields, assessment policy, and revision visibility. It is data,
not SQL or arbitrary JavaScript. Natural language helps author it; the inspected query
is what executes. Names such as "all invoices" resolve to visible saved definitions;
material ambiguity requires a choice rather than a silent change of meaning.

The first query language supports conjunction/disjunction, typed equality, membership,
ordered comparisons, known/present tests, and bounded existential occurrence bindings.
Only declared subject relationships are traversable. Add count, grouped count, and
sum over compatible units/currencies for inventory and simple analytics. Do not build
general recursive graph queries, arbitrary joins, or a user-programmable SQL engine.

### Existence before exclusion

For each travel occurrence in an admitted current document, require a resolved
destination and test that destination against the excluded place identities.
If a date is required by the Skill, require it on that same occurrence.

| Stored interpretation | Outside Berlin/Munich condition |
| --- | --- |
| Resolved destination Cluj | Match |
| Resolved destination Berlin or Munich | No match |
| No extraction yet, failed extraction, or unreadable region | Unknown; may request enrichment |
| Destination candidates include Berlin and Cluj | Unknown; needs resolution |
| Explicit accepted absence within fully assessed occurrence | No match |
| One Berlin segment and one Cluj segment | The Cluj segment matches; the Berlin segment does not |

Use true/false/unknown evaluation, retaining conflict and missing-coverage reasons on
unknown results. Boolean operators preserve unknown rather than turning it into a
match through negation. `exists` is true if any qualifying occurrence is proven, false
only if occurrence enumeration is complete and all candidates are false, otherwise
unknown. A known positive match remains usable even if other occurrences are unassessed.

Distinguish "has a destination outside these cities" from "has no destination in these
cities." The latter requires sufficient coverage to establish absence. Never infer
absence from a missing row. Defaults exclude unknowns from matching actions but show
them separately with an explanation. No general-purpose `not exists` operator ships
until its scoped completeness semantics are enforced.

"Incoming" belongs to the subscription's intake window, not document content. Record
an admission-sequence boundary and explicit backfill choice. An older file classified
today is not a new upload. A different subscription can explicitly watch existing
documents becoming understood. Future travel is a separate date condition; it must
not be inferred from the word incoming.

### Coverage and query receipts

Return inventory scope coverage, projection freshness, property-assessment coverage,
text readability, and pagination separately. Include known matches, unresolved counts
when computable, watermark, policy/descriptor versions, and the meaning of each count.
Do not claim exact totals from a sampled or capped scan. A schema catalog describes
possible information; inventory describes information actually present.

Read-only query receipts are structured responses and do not create an artifact per
click. Chat may retain a receipt in its contribution as evidence. Productive execution
persists a selection artifact containing the query, snapshot, evaluation time, exact
members and evidence bindings. Large selections use bounded paged manifests, not one
unbounded JSON array. Restricted evidence is reauthorized at use time.

The reviewer accepts authorized inventory/aggregation receipts for claims within their
scope. It still requires source evidence for document content claims. A query receipt
proves what the recorded data says, not that an extraction is factually correct.

## Skill composition and enrichment

### Requirements are separate from selectors

A port declares a typed subject/bundle, cardinality, required properties, relationships,
and support requirements. Binding that port selects one example, a saved collection,
another step's output, or a subscription delivery. This prevents a reusable Skill from
hard-coding a workspace-specific collection or hiding an implicit global query.

Materialize selected property bundles as typed run inputs with exact source/evidence
references. Do not feed an untyped virtual SQL row to a runtime expecting an artifact.
The planner uses the same descriptors to identify missing property producers. An
extractor guarantees a schema-valid result, not the presence of every desired value.
Only its observed successful fields satisfy downstream value requirements.

Outputs declare their subject relationship, property meanings, value schemas, and
possible missing/ambiguous outcomes. A Skill returning a collection must expose its
member schema. Nested Skills reuse these exact contracts and share root execution
budgets. Ideal nodes remain visibly hypothetical and cannot satisfy productive inputs
or enter normal observations until implemented and executed.

The LLM Actor must accept these typed bundles with semantic field labels and retained
evidence references, rather than requiring the chat to turn them into untracked literal
parameters. Output-property declarations are publication obligations: the runtime checks
the produced artifact and its subject/evidence bindings. They are not instructions to
find an unrelated existing artifact that happens to satisfy the output query.

### Lazy enrichment is an admitted run, not a query side effect

Separate baseline intake, demand-driven enrichment, and business actions:

- Baseline intake has a small, reviewed set of non-effecting inspections and extractors.
- Demand-driven enrichment fills properties requested by a user, Skill, or subscription.
- Business actions consume matched, admitted results under their own authority.

An enrichment policy declares eligible source population, property goals, allowed
Actors/model use, concurrency, byte/page/model-call/time limits, and retry behavior.
The population must be selectable before the desired property exists; otherwise the
system would wait for destinations while never scheduling destination extraction.

Reuse successful observations and terminal negative reports only for the matching
source revision, subject, contract, configuration and support policy. Concurrent
demands coalesce by that identity. Failure is retryable according to policy, not
"property absent." Cancellation, budget exhaustion, unavailable capability, and
coverage gaps remain explicit. A stronger/new extractor requires a new admitted attempt;
it does not cause perpetual re-extraction of everything.

No model-selected output schema, imported text, or "pure" Actor label is sufficient
to authorize execution. Intake runs with bounded parsing, resource isolation, and
allowlisted capabilities. Sending data to a model or external service requires the
applicable data-processing permission even when the operation is read-only.

## Document revisions and Intent associations

The latest product requirement generalizes this beyond documents: a task, list,
maintained dossier or Skill also retains a stable logical identity across changes.
The inspected Store already has immutable content records, namespaced schema versions,
typed structural references, run inputs and evidence. A schema's `typeVersion` is not
a revision of an individual artifact. Neither content hashes nor a publication/run ID
alone supply a current-head identity. Do not mistake these existing features for
implemented logical revision support.

Introduce stable logical artifact identity separately from immutable content identity.
A revision explicitly names its logical artifact, predecessor(s), and exact content artifact.
Initial creation and head advancement are authorized Store operations, not inferences
from generic lineage or filenames. A summary, translation, duplicate import, or Skill
variant is a distinct document unless replacement is explicitly requested.

Patching consumes an exact base and expected head. Publication records the new revision
and atomically advances the current head using compare-and-set, with an idempotent
command identity. Head integrity cannot rely on an eventually consistent search index.
Use a narrow Store transaction contract; do not expose arbitrary mutable relations.
If candidate content was published before head admission fails, retain it as a
non-current branch and show the conflict. Never expose it temporarily as the new head.

Normal search returns the designated current revision once. History search returns
prior revisions and branches. Exact citations and run inputs continue to open the
cited revision. The first editor supports a linear main history and explicit conflicts;
the contract permits multiple predecessors for a later merge operation without
requiring a general version-control UI now.

The public reference contract must explicitly distinguish `current` from `exact`:
a logical identity with no revision follows the designated head at read time; an exact
reference names a revision belonging to that identity. Resolve current references
once against the read/run snapshot and retain the exact result in all citations,
computations, provenance and Skill inputs. A current reference cannot masquerade as
evidence for a past run. Head movement is a compare-and-set operation; a rollback is
an auditable new decision, not deletion or rewriting of history.

Use one authoritative head record and immutable revision membership with scoped
foreign keys. Do not implement head discovery as repeated generic graph traversal,
or attempt a partial index predicate that compares columns from different tables.
Expose predecessor/successor and run lineage as navigable graph relationships without
storing redundant inverse edges. The database already isolates customer workspaces;
new tables/references must use that boundary and existing scope checks, not invent a
second multi-tenant routing model. UUID version choice is not the identity guarantee.
Logical deletion and content erasure need an explicit retention policy; immutable
normal-operation history is not a promise that private content can never be erased.

A mixed list is an ordinary typed logical artifact whose immutable revision retains
ordered membership references. Membership can follow a current head; a frozen export
or run pins members. Use whole-list optimistic revision checks first, with explicit
conflict handling; introduce fractional ranking only if measured concurrent-edit
needs justify it. Relation descriptions declare endpoint schemas, direction,
qualifiers, evidence and assessment policy. Human labels are localized; relation
identity is not free-form text. Derived inverse navigation need not be another saved
assertion. Provenance/system revision links cannot be mutated through user-authored
semantic relations. Cycles may be meaningful in semantic links but must be bounded
in traversal and forbidden where the specific relation requires acyclicity.

Tasks should consume this same revision/head contract through the existing task
Actor and UI ports. Move authoritative task state once that vertical slice passes;
keep any SQL task-list index rebuildable from artifacts. Do not dual-write independent
task truth and artifact snapshots or call a Markdown export artifact-backed tasks.
Existing task receipts, revision conflicts and manual updates are regression gates.

Mail-derived dossiers are maintained views over typed, sourced assertions: sender and
recipient occurrences, entity links, contracts, site roles and payment relationships.
An email address match does not authenticate a correspondent, prove a supplier role,
establish a debt or prove payment. Shared mailboxes, forwarded messages, spoofed headers,
reassigned addresses and conflicting time ranges require explicit unresolved states.
A Markdown dossier can be the first readable projection, retaining cited exact inputs;
it must not become a second source of truth for the asserted relationships. Backfill
and new-arrival maintenance use the same versioned rules and bounded source policies
described in the [knowledge-maintenance proposal](semantic-knowledge-maintenance.md).

The UI should navigate source → pages/parts → extracted observations, with a shared
type-selected preview: page rendering, text, image, formatted date/money/identifier,
or layout overlay as appropriate. Raw payload inspection remains a details action.
Mixed collections and Skill outputs reuse these descriptors in chat and tabs; lazy
loading and paging keep large trees bounded. Agent tools expose the same relationships
and exact/current distinction, including reverse references and coverage, not a
separate graph interpretation based on filenames. These remain implementation gates,
not a claim that a general graph or logical revision API is already installed.

Separate document identity from its Intent association. An immutable association
decision links or unlinks a document and an Intent; one document may be relevant to
several Intents. The first UI offers a primary filing destination and explicit links.
Do not duplicate the file or derive ownership solely from its original upload event.
Update the current attachment Actor to consume this association contract so attaching
to an existing chat Intent and rerouting both work through the shared runtime.

A Skill's "same Intent" target is frozen from the selected context at admission.
If several Intents qualify, choose by explicit port/policy or ask; never guess. Exact
history retains the association used then. Revision-following library links can show
the latest document, while evidence citations remain pinned to their original revision.

## Durable intake and bulk review

Dropping on conversation history selects that Intent; dropping on an Intent pill
selects that pill; dropping on the general import area selects intake. Show the target
during dragging and capture it at drop time. Existing-Intent upload must not call the
new-Intent path or reset the title/history. File selection uses the same intake command.

Persist an intake batch and per-item state before starting background work. Uploads
are customer-scoped artifacts with provenance, initially staged and excluded from
ordinary business queries/subscriptions. A private disposable trial sandbox is a
different concept: it must not emit productive arrivals or become an unnoticed source
of facts. Retention, cancellation and cleanup need explicit policy for both modes.

Intake progresses through captured, inspecting, ready-to-route, needs-review, admitted,
failed or cancelled. Readable state and retry reasons must survive client restart.
Explicit placement bypasses inferred routing, but not required safety checks. An
unreadable item may be filed with an explicit unassessed state; it is not represented
as successfully classified. Automatic routing uses a recorded policy and supporting
evidence, not an LLM's uncalibrated confidence number alone.

When no suitable Intent exists, propose creation or selection in the review queue.
Group related unresolved items into an open review case with a versioned grouping
decision. Category alone is insufficient: invoices for unrelated work must not be
merged merely because they are invoices. Similarity suggests grouping; it is not
identity. Cases support splitting, moving items, and undo through recorded decisions.

New related arrivals extend the open case. Approval freezes case revision and exact
member IDs; later arrivals remain unapproved unless a separately confirmed routing
rule covers them. Close resolved cases rather than reopening and replaying their
approval. Create-and-assign uses one idempotent command identity, so retries cannot
create duplicate Intents. Where cross-component publication cannot be atomic, persist
an outbox/reconciliation state and expose pending association until both sides agree.

Bulk imports use a bounded persistent queue with backpressure, per-item retries,
progress and paged/virtualized review lists. Do not eagerly render every preview or
download every original. Detect exact duplicate bytes to offer reuse, preserving each
capture's provenance; never silently equate distinct business records. No one-popup-
per-file workflow or new-Intent-per-file default is acceptable for general bulk intake.

## Query subscriptions and maintained outputs

A subscription pins query and Skill versions, execution authority, intake/backfill
scope, support policy, relevant fields, and output destination. Definition changes
create a new generation with a preview of their impact; edits do not retroactively
reinterpret deliveries already admitted.

Membership events are enter, relevant-change, and leave. Evaluation failures,
unprocessed observations, and permission loss are uncertainty or suspension, not proof
that a business condition became false. A leave event records its actual cause; an
irreversible action is never automatically undone merely because membership changed.

Persist subject membership, semantic value fingerprints, processing checkpoints and
deliveries transactionally. Re-extracting the same accepted values does not retrigger
an action just because observation IDs changed. A relevant support-policy change may
require reevaluation. Durable delivery is at least once; admission and effect Actors
must deduplicate by delivery identity. Do not claim universal exactly-once effects.

Bootstrap at a captured feed watermark, evaluate the initial snapshot under the
chosen backfill rule, then process later commits. Track projection checkpoints so the
consumer never advances past observations it has not evaluated. Rebuild a projection
without replaying completed business actions. Authorization or recovery-epoch changes
require a controlled rescan, not a fabricated stream of enters/leaves.

Start with subject-local predicates and bounded declared relationship paths. A publication
reevaluates affected subjects and dependent subscribed properties, not every query over
the whole database. Relationship assertions changing at the other end of a path must
also invalidate its dependent matches; document arrivals alone are insufficient. Maintain
bounded collection reports by debounced snapshot recomputation first. This correctly
handles corrections/removals without a bespoke delta algorithm for every aggregate.
Large or expensive aggregations must report a limit, not silently truncate. A later
incremental aggregate implementation must produce the same snapshot semantics.

For a maintained Markdown index, serialize updates to the logical output document,
freeze the collection snapshot, and check its head before publication. Coalesce newer
requests and prevent an older computation from overwriting a newer result. Preserve
which observations contributed; invoice totals and payment totals remain distinct,
and currencies are not added together without an explicit conversion contract.

Prevent loops with admission-time dependency checks plus runtime causation IDs,
reentrancy rules, and bounded cascades. Type-only cycle detection is too coarse when
both input and output are files. An output excluded by a reviewed source/subject rule
can be safe; an unresolved potential cycle fails closed. Never suppress unrelated
legitimate inputs merely because they share an output type.

Unattended means an authorized background worker, not a desktop polling session.
Extend the existing Actor Runner ownership/lease model with bounded, revocable
delegation and recovery. Before that is proven, label connections session-dependent.
Use the [selected worker authority protocol](semantic-knowledge-maintenance.md#selected-unattended-authority-and-discovery-protocol):
explicit owner/admin approval, operational environment discovery, fresh scoped worker
grants and commit-time activation fencing. Membership changes stop new grants; already
issued grants have bounded lifetime, not globally instantaneous revocation. Confirm
local activation cancellation only after its Store publication fence is closed.
Time-dependent predicates use an explicit evaluation clock and scheduled boundaries;
without that scheduler, offer snapshot evaluation only, not a misleading live rule.

## Human and agent interaction

Provide one authorized read surface with describe, inventory, query, sample and explain
operations, and separate prepare/enrich and subscribe commands. These names describe
responsibilities, not finalized routes. Agents and visual clients receive the same
schemas, coverage, errors and receipts. Avoid adding overlapping inventory tools next
to a different chat-only interpretation of the data.

The library shows collections, counts and unresolved items. Studio keeps one selected
example visible while letting the user choose one item, matching items now, or future
matches. Conditions have readable property names and explicit existence requirements.
Users can inspect inclusions and exclusions, save counterexamples, refine a query, or
create a variant. Overlapping variants require an explicit all-matching versus
exclusive-routing policy; no hidden precedence based on publication order.

Schema descriptors select trusted renderers, translated labels, grouping, and default
columns. Money, dates, addresses, identifiers, collections, uncertainty and conflicts
have compact defaults. Source/evidence expansion and raw records remain available.
Schemas cannot supply executable UI code or unsafe markup. Unknown types get a bounded
generic view rather than a blank panel. Correction publishes a decision and shows its
effect on dependent queries; it does not edit a cell without provenance.

Inventory, one-item preview, collection preview, and subscriptions share the same
query evaluator. The preview must show matching, excluded, unknown, and blocked cases
without running productive actions. Voice/text chat remains context-aware and can
author the exact same definitions. Samples are opt-in, limited, and labeled as samples;
neither a sample nor an empty match set establishes full coverage.

## Performance and ownership boundaries

Keep this within existing services and PostgreSQL. No graph database, separate search
cluster, universal ontology engine, or general stream-processing platform is required.

| Owner | Necessary responsibility |
| --- | --- |
| Shared artifact/Actor contracts | Value schemas, entity/relation descriptors, typed predicates and port contracts; one canonical validation contract |
| Artifact Store | Immutable records/assertions/evidence, revision admission, scoped semantic projection/query, snapshots and coverage receipts |
| Actor Runner and solver | Enrichment/matching budgets, frozen input bundles, rule-backed derivations, subscriptions and backfill/delivery recovery |
| Intent service | Authorized association/review commands and durable chat receipts; no independent fact resolver |
| Facade and native boundary | Allowlisted query/command transport, grants, limits and exact error preservation |
| Client library, Studio and chat | Shared presentation, scoped drop targets, grouped review, receipt-aware answers and contextual authoring |

Use typed indexes on scope, subject family, property, normalized value, current head
and source identity, plus evidence joins. Store mixed/rare values in bounded JSON
without pretending an unconstrained JSON scan scales. Compile only allowlisted
operators and paths; enforce query cost/depth/row/time limits server-side. Read queries
cause no model calls or source-blob transfers. SQL may read projected values to compute
inventory; "schema first" is not a claim that actual counts can be known from schemas.

Asynchronous projections expose a visible watermark and lag. Stronger reads can wait
within a bound or return pending; multiple projections must share a consistent read
boundary. Cache keys include customer/authorization context, query/descriptor/policy
versions, revision visibility and projection generation. Revoked access invalidates
results and unattended authority. Materializing a report must not expand access to
restricted source facts through counts, snippets, or derived text.

## Delivery sequence and acceptance gates

Implement vertical slices through the shared path. The sequence deliberately places
identity and read semantics before automation so later work does not need to replace
the foundations.

1. **Contracts and inventory.** Register subject/property/value descriptors for current
   document classifications, invoice observations, IBAN values and travel occurrences.
   Include entity-reference objects, relation descriptors, temporal scope and exact
   assertion-support references now, without implementing general inference. Implement
   scoped inventory receipts and make chat/reviewer consume them. Exit: the latest
   document-kind question returns supported counts and separate unknown coverage with
   zero original-blob or source-text retrieval and no extraction triggered by the question.
2. **Current documents and associations.** Add explicit revision identity/head admission,
   history queries and general Intent associations. Replace the upload-declaration-only
   attachment rule. Exit: concurrent Markdown patches cannot lose updates; existing-Intent
   drops preserve title/chat, and exact historical citations still resolve.
3. **Queries and Skill ports.** Implement the bounded query language, saved collections,
   property bundles, schema-driven views and solver contracts. Exit: the same definition
   works in agent tools, library and Studio; one document with Berlin and Cluj segments
   selects only the Cluj occurrence with its own date and evidence.
4. **Bounded enrichment and intake.** Add demand admission/reuse, persistent batch intake,
   explicit destinations, grouped review, and routing decisions. Exit: interruption and
   retry preserve all items, approvals exclude later arrivals, ambiguous parses remain
   unresolved, and no intake content can authorize a business action.
5. **Subscriptions and maintained reports.** Implement membership transitions, durable
   delivery, head-safe report updates, backfill, background delegation and scheduled
   reevaluation. Exit: work continues with the client closed under its approved scope;
   corrections, restarts and redelivery neither double-count nor duplicate effects.
6. **Reusable supplier knowledge.** Add stable parties, conversational assertion/decision
   Actors, deterministic role-aware matching and indexed knowledge backfill. Exit: a
   confirmed supplier/address or identifier association is recognized in both later and
   existing documents, remains explainable, and is withdrawn/reassessed after correction
   without merging parties or replaying historical business actions. The entity/relation
   contract is present from slice 1; this later behavior does not require a schema redesign.
   Follow the [knowledge-maintenance sequence](semantic-knowledge-maintenance.md#implementation-sequence-and-exit-gates)
   for dynamic relation definitions, materialization, correction and unattended mining.

At each slice, replace the old path rather than retaining parallel business logic.
Update the owning library, Studio, enrichment, customer-system-map and operations
documents as behavior lands. This proposal does not change current operational
procedures. The [build and test handbook](operations/build-and-test.md) remains the
authority for commands and the full native/customer-platform gate.

### Proof scenarios

- Inventory a mixed corpus with incomplete OCR: classification counts remain useful,
  text coverage stays separate, pagination completes without false completeness.
- Extract travel occurrences from multilingual receipts containing supplier addresses,
  departure/destination cities, issue dates and travel dates. Unknowns, conflicting
  cities, multiple segments and ambiguous numeric dates do not produce false matches.
- Extract and validate international identifiers: grouped and ungrouped IBANs, invalid
  check digits, unsupported country rules, OCR confusions, leading-zero identifiers,
  masked accounts, issuer-local invoice numbers and equivalent GTIN encodings. Verify
  that valid syntax never promotes ownership or payment authority, raw samples remain
  masked by default, and offline validation makes no external request.
- Through real Qwen chat, perform an ad-hoc travel query, inspect examples, skillify it,
  add a nested dossier Skill, then refine it with a counterexample. Verify each published
  contract, retained evidence, selected occurrence and resulting Intent association.
- Import a bulk corpus while navigating between Intents. Exact drop targets persist;
  general intake groups unresolved documents. Add arrivals during approval, split a
  group, retry a failed item and restart the worker without losing or silently approving it.
- Maintain a Markdown PDF index through arrivals, corrected classifications and
  concurrent patches. Normal search shows one current index; history and old citations
  remain exact. Replaying a delivery causes no duplicate update.
- Maintain a business summary across invoice/payment arrival, corrections, a duplicate
  capture and multiple currencies. Display separate supported measures and uncertainty;
  do not infer settlement or sum duplicate revisions.
- In real Qwen chat, associate an email, address and IBAN with a named supplier. Match
  new and previously extracted documents, preserving the exact human contribution and
  each derivation. Include two buyers, shared office addresses, a processor's shared
  account, different document roles, conflicting assertions and unknown validity dates.
  Verify that mentioning a supplier address does not imply that supplier issued the file.
- Correct/retract an association, reject a candidate and resume an interrupted backfill.
  Dependent matches become pending/unsupported or retain genuinely independent support;
  identical rejected candidates do not recur, historical run inputs remain unchanged,
  private relationships do not leak, and knowledge backfill does not replay effects.
- Exercise pause, revoke, reconnect, projection rebuild, stale snapshot, midnight/timezone
  transitions and Store recovery epochs. No private counts leak or effects replay merely
  because operational state was rebuilt.

User/agent journeys must use the configured real Qwen gateway, not canned model replies.
Deterministic unit/property tests additionally prove truth tables, decimal arithmetic,
concurrency, query budgets, and delivery identity. They do not replace live-model or
native end-to-end proof. Record model/configuration, schemas, query snapshots, runs,
receipts and remaining limits; a screenshot or successful tool call alone is not proof.

Measure at a realistic bulk scale (at least 10,000 documents with repeated observations)
and publish query plans, cold/warm timings, projection lag, calls and bytes transferred.
Gate inventory on zero original-blob reads, bounded resource use and complete paging;
set latency budgets on declared test hardware rather than inventing a scale guarantee.

## Deliberate limits and extension points

The first implementation is not a universal knowledge graph, automatic cross-document
entity merger, arbitrary continuous SQL system, or financial settlement engine. Bounded
entity association and rule-backed matching are supported extension goals, not implicit
identity merging. It
does not automatically trust schema-valid model output, resolve all locale ambiguity,
infer routing consent from document content, or hide branches by timestamp.

Extension points are versioned semantic descriptors, value schemas, typed subject
relationships, registered normalizers/resolvers, renderer kinds and bounded query
operators. They allow additional extractors and domains without Studio-specific code.
New operators require compiler, authorization, cost, snapshot and subscription-impact
semantics before admission. Unsupported contracts fail explicitly. These small, strict
boundaries keep future extension possible without implementing speculative machinery now.
