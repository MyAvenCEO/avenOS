---
title: Bookkeeping vertical on the correct ontology (SSOT) — gismu fidelity + Invoice Processing on the runner + per-step vibes
summary: SINGLE execution plan consolidating all open work. Rebuild the ontology to canonical gismu places (owned_by≡ponse, done=mulno, classified=cmima, produced=cupra; un-reverse attribute predicates) with FULL invoice granularity (line=pagbu, tax=cteki, rate=parbi, payment=pleji, identifiers=judri/cmene, Ansprechpartner=krati). Run the EXISTING "Invoice Processing" composite flow end-to-end on the generic runner with actors reimplemented on the ontology; stream a per-step vibe card into chat + the Runs explorer; consolidate (delete invoice-ingest, run_skill drives Invoice Processing, finish 0089's chat-trigger); migrate the old blob schemas; adapt the vibe views to the projected nested shape. The 0089/0090 runner + 0088 engine + ArtifactStore + type-registry + vibe-mechanism are the COMMITTED foundation this builds on. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [ontology, gismu, predication, invoice, bookkeeping, contact, skills, audit, migration]
goal: The ontology is rebuilt to canonical, domain-correct gismu places (verified against .claude/skills/ontology/gismu.json) and aligned through the stack — proven by tests + a live run: (1) a test asserts every predicate's `x-gismu` + per-place roles == the seed's canonical roles, with NO owner-in-a-place (ownership is the universal `owned_by`≡ponse predication on every entity) and NO reversed attribute predicates; (2) the `invoice` composite captures the FULL extract-doctype granularity as predications — number(cmene), total(jdima), due(detri), per-rate tax(cteki+parbi), payments(pleji), and N line items(pagbu) each with description(skicu)/quantity(klani)/unit-price(jdima)/amount(jdima)/tax — round-tripping via data_crud; (3) a `contact` is a person(prenu) OR company(kagni) with name(cmene)+address(judri)+metadata; (4) reconciliation links a transaction to its invoice via the PAYMENT (pleji.x4=invoice), and an invoice books to SKR04 accounts(cmima); (5) typed metadata maps to the right party — channels(judri: email/phone/IBAN) + identifiers(cmene: VAT-ID/tax-number/Rechnungsnummer) + the Ansprechpartner as a person(prenu) linked via represents(krati); (6) the engine projects child arrays (lines/taxes/payments/identifiers) and the invoice/doc-compare/addressbook vibe views render that nested shape; (7) the 0088 TypeSpecs + actors + data_crud field interface align, existing predications are re-synced (SQL shows the new shapes), and `bun run check` + tests exit 0. aven-db CRDT untouched.
---

# Ontology fidelity audit + rich domain modelling

## Context

The ontology was built fast with convenient 1:1 labels. Reading the seed end-to-end exposes both
**place errors** (owner-in-x1; reversed attribute predicates; wrong gismu) AND **shallow modelling**
(invoice = {number,amount,vendor,due} loses the line items, taxes, payments, addresses the extract
doctype actually captures; "match" is an abstract stand-in for what is really a *payment*). This card
fixes BOTH — the canonical places and the domain depth — and aligns the dependent skills/tools.
See [[ontology-gismu-skill]], [[universal-predication-schema-0084]], [[two-layer-schema-split]], [[bookkeeping]].

## Completed foundation (committed — 0089 / 0090 / 0091-step1)

This is the SSOT for the bookkeeping vertical. The execution engine it builds on is DONE + committed;
this card does NOT re-open it — it folds in the remaining OPEN work and supersedes the redundant slices:
- **Generic flow runner** (`aven-skills/src/runner`) — runFlow over any flow + actor registry, composite
  flatten, `onStep` per-step hook + `vibe`/`vibeData` on the trace — 0089 `dafe518a`, 0091 step 1.
- **Content-addressed ArtifactStore** (Postgres bytea, abstracted) — 0089 `2584826c`.
- **0088 generic predication engine** (mutate/query matcher, `predicate_type` registry, `data_crud`).
- **Type registry + flow table + `GET /api/skills/runs`** (real runs, no fixtures) — 0090 `ab0b0224`.
- **`run_skill` chat tool + text-form tool-call recovery; legacy doc tools deprecated** — `24af443c`.

**Folds in / supersedes:** the remaining open work of **0089** (live chat-trigger, step 7) and **0091**
(Invoice Processing flow + actors + per-step vibe streaming) → retire 0091; **0090**'s `invoice-ingest` is
deleted here. 0089/0090 stay as the committed foundation record.

## Universal: ownership = `owned_by` ≡ ponse

Every entity belongs to an account. Model it as a UNIVERSAL predication, not a column-as-semantics and
not a place on the primary:
- **owned_by ≡ ponse** — `ponse(x1 owner-account, x2 possession)` → `owned_by(x1=account, x2=entity)`.
- Added as a part on EVERY composite type. The `data_value.user_id` column stays for fast scoping but
  is now a *mirror* of `owned_by.x1`, not the source of ownership meaning. "This item belongs to
  account X" is a first-class, queryable fact.
- Consequence: primary predicates use their canonical places freely — the owner never occupies x1
  (unless the gismu's x1 genuinely IS the agent, e.g. zukte/task).

## The corrected ontology (current → CANONICAL, with depth)

**Todos**
| pred | gismu | canonical places | fix |
|---|---|---|---|
| task | zukte | x1 actor · x2 action · x3 goal | x1=user(actor) ✓, x2=title(action); + owned_by |
| due | detri | x1 date · x2 event | ✓ x1=date, x2=task |
| prioritized | vajni | x1 significant · x2 audience · x3 aspect | ✓ x1=task, x2=user, x3=level |
| done | **mulno** | x1 complete-thing | ⊘ replaces valid(ranji from/to): `done(x1=task)`; open = absent |

**Document**
| pred | gismu | canonical places | fix |
|---|---|---|---|
| document | vreji | x1 record · x2 data · x3 subject · x4 medium | row IS the record; x2=summary, x3=subject, x4=medium(artifact); owner→owned_by |
| named | **cmene** | x1 name · x2 named-thing · x3 namer | ➕ title/number → x1=name, x2=entity, x3=user |
| classified | **cmima** | x1 member · x2 set | ⊘ x1=document, x2=kind-set (membership, not klesi) |
| summary | skicu | x1 describer · x2 subject · x4 description | ↔ x2=document(subject), x4=text |
| source | krasi | x1 source · x2 originated | ✓ x1=artifact, x2=entity |
| produced | **cupra** | x1 producer · x2 product · x3 process | ⊘ replaces finti(invent): `cupra(x1=run, x2=entity, x3=skill)` |

**Invoice — FULL granularity (the extract doctype, as predications)**
| pred | gismu | places | maps doctype field |
|---|---|---|---|
| invoice | **janta** | x1 account/bill · x2 goods · x3 billed-party · x4 biller | the bill; x3=us(owned_by acct), x4=vendor ref |
| named | cmene | x1 number · x2 invoice · x3 user | header.invoice_number |
| due | detri | x1 date · x2 invoice | header.due_date / issue_date |
| total | **jdima** | x1 price · x2 invoice · x3 purchaser · x4 vendor | totals.invoice_total (↔ amount was reversed) |
| tax | **cteki** | x1 tax · x2 taxed-thing · x3 taxpayer · x4 authority | totals.tax_breakdown[] (one per rate) |
| rate | **parbi** | x1 ratio · x2 numerator · x3 denominator | tax_rate_percent (e.g. 19/100) |
| payment | **pleji** | x1 payer · x2 amount · x3 payee · x4 for-what(invoice) | payments[] |
| line | **pagbu** | x1 part(line) · x2 whole(invoice) | statements[].line_items[] |
| ↳ line desc | skicu | x2 line(subject) · x4 text | line_items[].description |
| ↳ line qty | **klani** | x1 quantity · x2 amount · x3 scale(unit) | quantity + quantity_unit |
| ↳ line price | jdima | x1 unit-price · x2 line | unit_price |
| ↳ line amount | jdima | x1 amount · x2 line | line amount |
| vendor | — | (folded) | = janta.x4 biller → a `contact` ref (kagni/prenu) |
| source | krasi | x1 artifact · x2 invoice | file_hash (provenance) |

**Contact — person OR company + addresses + identifiers + Ansprechpartner**
| pred | gismu | places | note |
|---|---|---|---|
| person | **prenu** | x1 person | a HUMAN contact |
| organization | **kagni** | x1 company · x2 authority · x3 purpose | a COMPANY contact |
| named | cmene | x1 name · x2 contact · x3 user | the contact's display name |
| address | **judri** | x1 address-value · x2 contact · x3 system | ONE predicate for postal/email/phone/IBAN — `x3=system` ∈ {postal, email, phone, sepa-iban} (+ a `label`) |
| identifier | **cmene** | x1 id-value · x2 contact · x3 issuer | VAT-ID/USt-IdNr, tax-number, HRB-register, etc. — + a `kind` ∈ {vat_id, tax_number, commercial_register, …}. (Rechnungsnummer on an invoice = same shape.) |
| represents | **krati** | x1 representative · x2 represented · x3 matter | **Ansprechpartner**: a `person`(prenu) represents the `company`(kagni); the person has its own name/identifiers/channels |

**Identifiers & channels (the rule):** every typed reference is one of two shapes — a **channel** ≡
`judri` (something you reach the entity AT: postal/email/phone/IBAN, distinguished by `x3 system`) or an
**identifier** ≡ `cmene` (something that NAMES/tags the entity: VAT-ID, tax-number, register-no,
invoice-no, distinguished by `kind` + `x3 issuer`). The extract actor emits these onto the right party
(vendor company, its Ansprechpartner person, or the invoice), and enrich dedupes/links them to a stored
contact. No metadata is lost vs. the doctype's `org_public_record.identifiers[]` / `reference_entries[]`.

**Transaction & reconciliation — the payment IS the link**
| pred | gismu | places | note |
|---|---|---|---|
| transaction | **pleji** | x1 payer · x2 amount · x3 payee · x4 for-what | a bank movement = a payment |
| (settles) | — | pleji.x4 = invoice | reconciliation = set the payment's x4 to the invoice. NO "match"/mapti type. |
| (owed) | **dejni** | x1 debtor · x2 amount · x3 creditor · x4 consideration | optional: an unpaid invoice as a debt |

**Booking — German SKR04 posting**
| pred | gismu | places | note |
|---|---|---|---|
| booked | **cmima** | x1 member · x2 set(SKR04 Konto) | the invoice/expense is a member of an SKR04 account (e.g. "6010") |
| (Soll/Haben) | cmima ×2 | debit-account + credit-account | double-entry: two `booked` rows (debit, credit) + amount(jdima) |
| amount | jdima | x1 amount · x2 booking | the posted amount |

## Principles

1. **Ownership = `owned_by`≡ponse** (universal predication), never a place — unless the gismu's x1 IS the agent.
2. **Use the gismu's exact x1–x5 roles** (value-first where the gismu is: jdima x1=price, detri x1=date, cteki x1=tax).
3. **Pick the meaning-correct gismu** (cmima membership, mulno done, cupra produce, cmene name, judri address, pleji pay, pagbu part, cteki tax, parbi rate, klani quantity).
4. **Model the relationship, not a label** — tx↔invoice is `pleji.x4`; don't invent a "match".
5. **Fold, don't duplicate** (vendor = janta biller); **no forced gismu** where none fits (email/booking-entry).
6. **Capture full domain granularity** — line items, per-rate tax, payments, addresses become predications, matching the extract doctype 1:1.

## Approach / skills + tools alignment (the cascade)

- **vocab** (`aven-vibes/src/predicate/*`) — rewrite every PredicateDef to canonical places + new ones
  (owned_by, named, done, total, tax, rate, payment, line, person, organization, address, transaction, booked).
- **TypeSpecs** (`aven-ontology/*`) — todo/document/invoice rebuilt; new contact/transaction/booking; the
  invoice spec gains the rich parts (+ a line-item sub-shape — likely a `line` child type referencing the invoice).
- **actors** (`betterauth/skills-run.ts`) — `extract` maps the doctype JSON → the rich predication set
  (this is where the granularity lands); `enrich` → contact(prenu/kagni)+address; `match`→pleji.x4;
  `book`→SKR04 cmima; all set `owned_by`.
- **data_crud / schemasPromptHint** — the LLM-facing field names stay pragmatic English; only places move.
- **nested projection (engine)** — the 0088 `query` matcher gains CHILD/array projection: a parent type
  projects its child predications as a sub-array (invoice `lines[]`/`taxes[]`/`payments[]`; a party's
  `identifiers[]`/`channels[]`/`represents`). Needed so the rich graph reads back as a nested shape.
- **vibe views** — the invoice / doc-compare / addressbook / bwa vibes read the engine's PROJECTED nested
  shape (kept ≈ their current props), so they need minor adaptation, not a rewrite; verify each renders
  the new shape (line items, taxes, vendor + its Ansprechpartner + identifiers).
- **data re-sync** — migration park→convert→swap existing task/document/invoice predications to the new shapes.

**Out of scope (follow-on):** the HITL review pause/resume (review auto-posts); the bank-statement
(kontoauszug) vertical; a visual ontology browser.

## Steps (small, checkpointed)

1. **owned_by + corrected core vocab** — ponse owned_by (universal); todo (done=mulno) + document
   (vreji/cmima/skicu/cupra/named) rewritten; predicate test asserts places == seed. **Checkpoint.**
2. **Rich invoice vocab + spec** — janta/cmene/detri/jdima/cteki/parbi/pleji/pagbu(+line sub-type) +
   identifiers (judri channels / cmene IDs) + Ansprechpartner(krati); data_crud(invoice) round-trips
   lines + taxes + payments. **Checkpoint.**
3. **Contact / transaction / booking ontology** — person(prenu)/company(kagni)/address(judri); pleji
   transaction with x4-settlement; SKR04 booked(cmima). **Checkpoint.**
4. **Engine nested/array projection** — parent types project child predications as sub-arrays
   (invoice lines/taxes/payments; party identifiers/channels/represents). **Checkpoint.**
5. **Ontology actors + Invoice Processing on the runner** — extract/enrich/match/book/review
   reimplemented on the ontology (emit the rich predications + owned_by); the EXISTING `invoice` flow
   flattens + runs all steps; `run_skill` drives it; **delete `invoice-ingest`**. **Checkpoint.**
6. **Per-step vibe streaming + view adaptation** — `run_skill` emits `aven_vibe` per step (chat) + the
   Runs StepVibe renders the SAME card; adapt invoice/doc-compare/addressbook/bwa to the projected
   nested shape. **Checkpoint.**
7. **Chat trigger (finish 0089 step 7) + data re-sync** — a real-document chat turn drives Invoice
   Processing end-to-end; migrate existing predications + the old tx/contact/booking blob schemas to
   the new shapes. **Checkpoint.**
8. **Verify** — places==seed, rich invoice round-trip (incl. identifiers + Ansprechpartner), a live chat
   run with a per-step vibe card, repo gates.

## Acceptance criteria

- [ ] Test: every predicate's `x-gismu` + per-place roles == the gismu seed (todo/document/invoice/contact/tx/booking).
- [ ] No owner stored in a place; every entity has an `owned_by`≡ponse predication (SQL).
- [ ] Meaning-correct gismu applied: done=mulno, classified=cmima, produced=cupra, summary/amount un-reversed, named=cmene, address=judri, tax=cteki, rate=parbi, line=pagbu, quantity=klani, transaction=pleji, person=prenu, organization=kagni.
- [ ] `invoice` round-trips the FULL doctype granularity (≥1 line item with desc/qty/price/amount, ≥1 tax rate, payments) via data_crud + SQL.
- [ ] Identifiers + Ansprechpartner: the vendor company carries `identifier`(cmene, e.g. kind=vat_id) + `channel`(judri, e.g. system=email) + Rechnungsnummer(cmene on the invoice), and its Ansprechpartner is a `person`(prenu) linked via `represents`(krati) — SQL shows them mapped to the right party.
- [ ] The engine projects child arrays (lines/taxes/payments/identifiers); the vibe views (invoice / doc-compare / addressbook) RENDER that nested shape — verified live.
- [ ] A transaction settles an invoice via `pleji.x4=invoice` (no `match` type); an invoice books to an SKR04 account via `booked`(cmima).
- [ ] The EXISTING `invoice` (Invoice Processing) flow runs end-to-end on the generic runner (trace store→classify→extract→enrich→match→book→review); `run_skill` drives it; `invoice-ingest` is deleted (`rg -n "invoice-ingest" libs` empty).
- [ ] A live CHAT turn (attach an invoice, "book this") drives Invoice Processing end-to-end, streaming an `aven_vibe` card per step; the Runs explorer renders the same per-step cards.
- [ ] 0088 engine round-trips on all corrected specs; existing predications re-synced (counts preserved).
- [ ] `data_crud`/`schemasPromptHint` field interface unchanged (chat unaffected); `bun run check` + tests exit 0; aven-db untouched.

## Verification

```bash
(cd libs/aven-vibes && bun run check && bun test tests/predicate.test.ts)   # places == seed
(cd libs/aven-ontology && bun run check && bun test)
(cd libs/betterauth && bun run check)
# Live (running auth server):
#   data_crud(invoice, create {full doctype}) → list → number/total/due + tax[] + payments[] + lines[]
#   SELECT data FROM data_value … name='line'      → pagbu (x1=line, x2=invoice)
#   SELECT data FROM data_value … name='transaction' → pleji; reconciled row has x4 = an invoice id
#   SELECT data FROM data_value … name='owned_by'  → ponse (x1=account, x2=entity)
```

## Hand-off

```
/aven-build 0092
```

## Progress log

Newest entry first.

- `2026-06-29` — **Consolidated into the SSOT execution plan.** Folded ALL remaining open work into 0092:
  0091 (Invoice Processing flow + actors + per-step vibe streaming) entirely → 0091 retired; 0089's open
  chat-trigger (step 7) → step 7 here; 0090's `invoice-ingest` is deleted by step 5. Added a "Completed
  foundation" section (runner/engine/ArtifactStore/registry/vibe-mechanism, with commit refs) as the
  committed base. Steps 5–7 now carry the flow/runner/chat work; 8 checkpointed steps total. One card to
  execute against.
- `2026-06-29` — Added metadata + vibe scope. Typed references unified: **channel ≡ judri** (postal/
  email/phone/IBAN, by `x3 system`) + **identifier ≡ cmene** (VAT-ID/USt-IdNr/tax-number/HRB/
  Rechnungsnummer, by `kind`+issuer), extracted + enriched onto the right party. **Ansprechpartner ≡
  krati** (a person/prenu represents a company/kagni). And the engine gains **child/array projection**
  so the rich graph (lines/taxes/payments/identifiers) reads back nested — the invoice/doc-compare/
  addressbook **vibe views** then render that shape (minor adaptation). +1 step (vibes) → 7 steps.
- `2026-06-29` — Discovery, upgraded after deeper review. Beyond fixing places, the user pushed for
  DOMAIN-correct modelling: ownership as a universal `owned_by`≡ponse predication (drop owner-from-x1 /
  user_id-as-owner); contacts as person(prenu) vs company(kagni) + address(judri) + metadata; the FULL
  invoice granularity of the extract doctype as predications (line=pagbu, tax=cteki, rate=parbi,
  payment=pleji, total=jdima, qty=klani); tx↔invoice as the PAYMENT (pleji.x4), not an abstract match;
  SKR04 booking as account membership (cmima). Re-read the seed e2e for ponse/cupra/prenu/kagni/judri/
  cteki/parbi/pagbu/klani/pleji/cmene/mulno/cmima. produced=finti corrected → cupra. 6 checkpointed
  steps incl. data re-sync. Out of scope: 0091 build, bank-statement vertical, ontology browser.
- `2026-06-29` — Discovery (initial). Audit found owner-in-x1 + reversed attribute predicates + wrong
  gismu (klesi→cmima, ranji-split→mulno). Created in discover/.
