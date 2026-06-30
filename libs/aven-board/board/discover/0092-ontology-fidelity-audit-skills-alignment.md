---
title: Ontology fidelity audit + rich domain modelling — canonical gismu, owned_by, full invoice graph
summary: Re-read the gismu seed end-to-end and rebuild the ontology to MEAN what the domain means, not convenient labels. Universal ownership as owned_by≡ponse (this item belongs to account X) — drop owner-from-x1 and the user_id-as-owner idea. Person vs company contacts (prenu/kagni) with addresses (judri) + metadata. The FULL invoice granularity of the extract doctype (line items≡pagbu, tax≡cteki, rate≡parbi, payments≡pleji, totals≡jdima/vamji, vendor≡biller) as a predication graph. Transaction↔invoice is the PAYMENT itself (pleji.x4→invoice), not an abstract "match". German SKR04 booking as account postings (cmima/janta). Then align the 0088 TypeSpecs, skills/tools/actors, data_crud interface + re-sync data. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [ontology, gismu, predication, invoice, bookkeeping, contact, skills, audit, migration]
goal: The ontology is rebuilt to canonical, domain-correct gismu places (verified against .claude/skills/ontology/gismu.json) and aligned through the stack — proven by tests + a live run: (1) a test asserts every predicate's `x-gismu` + per-place roles == the seed's canonical roles, with NO owner-in-a-place (ownership is the universal `owned_by`≡ponse predication on every entity) and NO reversed attribute predicates; (2) the `invoice` composite captures the FULL extract-doctype granularity as predications — number(cmene), total(jdima), due(detri), per-rate tax(cteki+parbi), payments(pleji), and N line items(pagbu) each with description(skicu)/quantity(klani)/unit-price(jdima)/amount(jdima)/tax — round-tripping via data_crud; (3) a `contact` is a person(prenu) OR company(kagni) with name(cmene)+address(judri)+metadata; (4) reconciliation links a transaction to its invoice via the PAYMENT (pleji.x4=invoice), and an invoice books to SKR04 accounts(cmima); (5) the 0088 TypeSpecs + skills-run actors + data_crud field interface align, existing predications are re-synced (SQL shows the new shapes), and `bun run check` + tests exit 0. aven-db CRDT untouched.
---

# Ontology fidelity audit + rich domain modelling

## Context

The ontology was built fast with convenient 1:1 labels. Reading the seed end-to-end exposes both
**place errors** (owner-in-x1; reversed attribute predicates; wrong gismu) AND **shallow modelling**
(invoice = {number,amount,vendor,due} loses the line items, taxes, payments, addresses the extract
doctype actually captures; "match" is an abstract stand-in for what is really a *payment*). This card
fixes BOTH — the canonical places and the domain depth — and aligns the dependent skills/tools.
See [[ontology-gismu-skill]], [[universal-predication-schema-0084]], [[two-layer-schema-split]], [[bookkeeping]].

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

**Contact — person OR company + addresses + metadata**
| pred | gismu | places | note |
|---|---|---|---|
| person | **prenu** | x1 person | a human contact |
| organization | **kagni** | x1 company · x2 authority · x3 purpose | a company contact |
| named | cmene | x1 name · x2 contact · x3 user | the contact's name |
| address | **judri** | x1 address · x2 contact · x3 system | postal address (one per location) |
| located | **stuzi** | x1 location · x2 contact | physical site (optional) |
| (email/phone/tax_id) | cmene/judri | — | identifiers as named/address rows (no forced gismu where none fits) |

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
- **data re-sync** — migration park→convert→swap existing task/document/invoice predications to the new shapes.

**Out of scope (follow-on):** building 0091's flow/runner wiring (this card fixes the ontology base it
needs); a visual ontology browser; bank-statement (kontoauszug) vertical.

## Steps (small, checkpointed)

1. **owned_by + corrected core vocab** — ponse owned_by (universal); todo (done=mulno) + document
   (vreji/cmima/skicu/cupra/named) rewritten; predicate test asserts places == seed. **Checkpoint.**
2. **Rich invoice vocab + spec** — janta/cmene/detri/jdima/cteki/parbi/pleji/pagbu(+line sub-type);
   data_crud(invoice) round-trips with line items + taxes + payments. **Checkpoint.**
3. **Contact (person/company) + transaction + booking** — prenu/kagni/judri; pleji transaction with
   x4-settlement; SKR04 booked(cmima). **Checkpoint.**
4. **Skills/tools alignment** — actors emit the rich predications + owned_by; data_crud interface stable. **Checkpoint.**
5. **Data re-sync** — migrate existing predications to the corrected shapes; SQL proves shapes; counts preserved. **Checkpoint.**
6. **Verify** — places==seed assertion, rich invoice round-trip, repo gates.

## Acceptance criteria

- [ ] Test: every predicate's `x-gismu` + per-place roles == the gismu seed (todo/document/invoice/contact/tx/booking).
- [ ] No owner stored in a place; every entity has an `owned_by`≡ponse predication (SQL).
- [ ] Meaning-correct gismu applied: done=mulno, classified=cmima, produced=cupra, summary/amount un-reversed, named=cmene, address=judri, tax=cteki, rate=parbi, line=pagbu, quantity=klani, transaction=pleji, person=prenu, organization=kagni.
- [ ] `invoice` round-trips the FULL doctype granularity (≥1 line item with desc/qty/price/amount, ≥1 tax rate, payments) via data_crud + SQL.
- [ ] A transaction settles an invoice via `pleji.x4=invoice` (no `match` type); an invoice books to an SKR04 account via `booked`(cmima).
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
