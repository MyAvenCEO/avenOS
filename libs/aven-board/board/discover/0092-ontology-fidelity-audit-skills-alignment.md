---
title: Ontology fidelity audit — canonical gismu places + skills/tools alignment
summary: Audit EVERY predicate against the Lojban gismu seed and correct the x1–x5 places to the canonical roles (stop forcing owner-into-x1 — user_id already scopes; stop reversing attribute predicates; pick the right gismu, leave it unforced where none fits). Then propagate the corrected places through the 0088 TypeSpecs, the skills/tools/actors that map fields→places, the data_crud field interface the LLM sees, and the flow/vibe configs — and re-sync existing predications. mainnet Postgres only; aven-db CRDT untouched.
owner: claude
created: 2026-06-29
updated: 2026-06-29
tags: [ontology, gismu, predication, skills, tools, audit, migration]
goal: Every predicate's stored data_schema matches its CANONICAL gismu place structure (verified against .claude/skills/ontology/gismu.json) — proven by a test/assertion that each `pred:*` schema's `x-gismu` + per-place roles equal the seed's canonical roles (no owner-in-x1 unless the gismu's x1 IS the agent; no reversed attribute predicates); the corrected places propagate to the 0088 TypeSpecs, the skills-run actors, the data_crud/schemasPromptHint field interface, and the flow/vibe configs (all tsc-clean + consistent); existing predications are re-synced to the corrected places (SQL shows the new shapes); and `bun run check` + the new tests exit 0. aven-db CRDT untouched.
---

# Ontology fidelity audit + skills/tools alignment

## Context

The ontology was built fast, forcing convenient mappings. A read of the gismu seed exposes SYSTEMATIC
deviations: (a) the **owner jammed into x1** even when the gismu's x1 isn't the agent — yet the
`data_value` row already has a `user_id` column, so ownership never needs a place; (b) **attribute
predicates reversed** (the canonical gismu often puts the VALUE in x1, the entity in x2 — I did the
opposite); (c) **wrong gismu** for some concepts; (d) **redundant predicates** that are really another
place of the primary gismu. Correctness here is load-bearing: the places drive the 0088 TypeSpecs, the
actors, the `data_crud` field interface, and the vibe/flow configs. See [[ontology-gismu-skill]],
[[universal-predication-schema-0084]], [[two-layer-schema-split]].

## The audit (current → CANONICAL)

Legend: ✓ keep · ✏️ fix places · ↔ reverse · ⊘ replace gismu · ✂️ fold into another predicate's place.

**Todos**
| pred | gismu | canonical places (seed) | current | verdict |
|---|---|---|---|---|
| task | zukte | x1 actor · x2 action · x3 goal | x1=user, x2=title | ✓ (actor IS the user; canonical) |
| due | detri | x1 date · x2 event | x1=date, x2=task | ✓ |
| prioritized | vajni | x1 significant-thing · x2 audience · x3 aspect | x1=task, x2=user, x3=level | ✓ (x3 level ≈ aspect) |
| ~~valid~~ → **done** | mulno | x1 complete-thing | x1=task, x2=from, x3=to | ⊘ ranji's x2 is ONE interval (no from/to split). "done" = **mulno**(x1=task); open = absent. Drop the interval hack. |

**Document**
| pred | gismu | canonical places | current | verdict |
|---|---|---|---|---|
| document | vreji | x1 record · x2 data · x3 subject · x4 medium | x1=owner, x2=title | ✏️ row IS the record; x2=summary/data, x3=subject, x4=medium(artifact sha); **owner→user_id**; title→`named`(cmene) |
| classified | ~~klesi~~ **cmima** | x1 member · x2 set | x1=document, x2=kind | ⊘ membership = **cmima**: x1=document, x2=kind-set |
| summary | skicu | x1 describer · x2 subject · x3 audience · x4 description | x1=document, x2=text | ↔ x2=document(subject), x4=text(description) |
| source | krasi | x1 source · x2 originated | x1=artifact, x2=document | ✓ |
| produced | finti | x1 inventor · x2 invention | x1=run, x2=document | ✓ |
| (title) | cmene | x1 name · x2 named-thing · x3 namer | — | ➕ x1=title, x2=document, x3=user |

**Invoice**
| pred | gismu | canonical places | current | verdict |
|---|---|---|---|---|
| invoice | janta | x1 account · x2 goods · x3 billed-party · x4 biller | x1=owner, x2=number | ✏️ row IS the bill; x2=goods/desc, x3=billed-party(user), x4=biller(vendor); **owner→user_id**; number→`named`(cmene) |
| amount | jdima | x1 price · x2 item · x3 purchaser · x4 vendor | x1=invoice, x2=total | ↔ x1=amount(price), x2=invoice(item) |
| ~~vendor~~ | vecnu | — | x1=invoice, x2=name | ✂️ vendor IS `janta`.x4 (biller) → fold into invoice; drop the separate predicate |

**0091 new (corrected before building)**
| pred | gismu | canonical places | mapping |
|---|---|---|---|
| transaction | pleji | x1 payer · x2 payment · x3 payee · x4 goods | x1=payer, x2=amount, x3=payee, x4=reference |
| match | mapti | x1 fitting · x2 counterpart · x3 aspect | x1=invoice, x2=tx, x3=aspect(amount+date) |
| contact | ⊘ none | — | NO person-or-org gismu — model a named party: `named`(cmene) x1=name,x2=contact,x3=user + kind via cmima(x1=contact,x2=person|organization). Don't force prenu/kagni. |
| booking | ⊘ weak | — | no "ledger posting" gismu; pragmatic: x1=invoice(ref), account(SKR04 value), amount; reuse source/produced provenance |

## Principles (the rules going forward)

1. **Owner = `user_id`, never a place** — unless the gismu's x1 genuinely IS the agent (zukte/vajni).
2. **Use the gismu's exact x1–x5 roles** — attribute predicates put the VALUE where the gismu does
   (jdima x1=price, detri x1=date, krasi x1=source), entity in the later place.
3. **Pick the right gismu** — membership=cmima, completion=mulno, naming=cmene, fit=mapti, pay=pleji.
4. **Fold, don't duplicate** — if an attribute is already another place of the primary gismu
   (vendor = janta biller x4), use that place; don't mint a parallel predicate.
5. **No forced gismu** — where none fits (contact, booking), use a pragmatic predicate with `gismu: null`.

## Approach / skills + tools alignment (the cascade)

The corrected places propagate, in lockstep:
- **vocab** (`aven-vibes/src/predicate/*-vocab.ts`) — rewrite each PredicateDef's places (+ x-gismu).
- **TypeSpecs** (`aven-ontology/*-spec.ts`) — re-map each field → its corrected place + projection.
- **actors** (`betterauth/src/skills-run.ts`) — the field→item mappings the actors emit.
- **data_crud field interface** — `schemasPromptHint` (the LLM-facing field names) stays the SAME
  pragmatic English ({title, kind, due, …}); only the underlying places move, so the chat tool is
  unaffected — VERIFY this holds (the engine maps fields→places).
- **flow/vibe configs** — unaffected by places, but re-confirm.
- **data re-sync** — a migration re-maps existing predications to the corrected places (park→convert,
  like 0090) so live data isn't orphaned.

**Out of scope (follow-on):** building 0091's flow/actors (this card only fixes the ontology + alignment
so 0091 builds on a correct base); a visual ontology browser.

## Steps (small, checkpointed)

1. **Corrected vocab** — rewrite todo/document/invoice PredicateDefs to canonical places (done=mulno,
   classified=cmima, summary↔, amount↔, vendor folded, owner-out-of-x1, named=cmene); predicate tests
   assert each schema's places == the seed's canonical roles. **Checkpoint.**
2. **Corrected TypeSpecs** — re-map TODO/DOCUMENT/INVOICE_SPEC fields → corrected places; engine unit
   tests (mutate/query) still green on the new shapes. **Checkpoint.**
3. **Data re-sync** — migration re-maps existing task/document/invoice predications to the corrected
   places (park→convert→swap); SQL shows the new shapes; nothing orphaned. **Checkpoint.**
4. **0091 new types on the corrected base** — register transaction(pleji)/match(mapti)/contact/booking
   with the canonical structures. **Checkpoint.**
5. **Verify** — places==seed assertion, engine round-trips, data_crud unchanged field interface, repo gates.

## Acceptance criteria

- [ ] An assertion/test proves each `pred:*` schema's `x-gismu` + per-place roles == the gismu seed's canonical roles (todo/document/invoice + new).
- [ ] No predicate stores the owner in a place unless the gismu's x1 is the agent (grep/inspect).
- [ ] Corrected gismu applied: `done`=mulno, `classified`=cmima, `summary`/`amount` un-reversed, `vendor` folded into `invoice`(janta x4), `named`=cmene; `transaction`=pleji, `match`=mapti; contact/booking `gismu:null`.
- [ ] 0088 engine round-trips (create→list) on the corrected TypeSpecs — tests exit 0.
- [ ] Existing task/document/invoice predications re-synced to the corrected places — SQL shows the new shapes; counts preserved.
- [ ] `data_crud`/`schemasPromptHint` field interface unchanged (chat unaffected) — verified.
- [ ] `bun run check` + tests exit 0; aven-db untouched.

## Verification

```bash
(cd libs/aven-vibes && bun run check && bun test tests/predicate.test.ts)   # places == seed
(cd libs/aven-ontology && bun run check && bun test)                        # engine on corrected specs
(cd libs/betterauth && bun run check)
# Live (running auth server):
#   data_crud(todos|document|invoice, list) round-trips unchanged (field interface stable)
#   SELECT data FROM data_value … WHERE name='invoice'  → janta places (x2 goods, x3 billed, x4 biller)
#   SELECT data FROM data_value … WHERE name='amount'   → x1 = the amount (price), x2 = invoice
```

## Hand-off

```
/aven-build 0092
```

## Progress log

Newest entry first.

- `2026-06-29` — Discovery. Triggered by review: `prenu` is person-only (wrong for company contacts),
  and I'd been forcing owner-into-x1 + reversing attribute predicates. User chose a FULL ontology audit
  first (pause 0091's build), and to also upgrade the skills/tools to match. Read the seed for every
  used + candidate gismu; built the current→canonical table; derived 5 principles. Corrected: done=mulno,
  classified=cmima, summary/amount un-reversed, vendor folded into janta.x4, owner→user_id, named=cmene;
  transaction=pleji, match=mapti; contact/booking gismu:null (no fit). 5 checkpointed steps incl. a data
  re-sync. Out of scope: 0091's flow/actors (builds on this corrected base). Created in discover/.
