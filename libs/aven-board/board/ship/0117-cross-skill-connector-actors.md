---
title: Cross-skill connector actors — "every banking tx updates inventory"
summary: A skillify seam that authors CONNECTOR actors — GLM-written sandbox code with ops caps over TWO skills' schemas (smoke-gated), plus the trigger question (callable v1 vs data-event flow edges v2).
owner: claude-code
created: 2026-07-04
updated: 2026-07-04
tags: [skillify, actors, flows, cross-skill]
goal: "bun --env-file=.env.samuel test libs/betterauth/tests/ passes twice in a row with connector tests (scoped ops caps deny ungranted ops · connectSkills wires the actor row with per-schema caps + the composite flowRef node · smoke gate blocks bad code), bunx tsc --noEmit -p libs/betterauth exits 0, svelte-check clean"
---

# Cross-skill connector actors

## Idea

Live trigger (2026-07-04): Samuel asked "update our banking skill to also keep
track of stuff we buy and sell into our inventory — see the inventory skill for
details". This is a CROSS-SKILL BEHAVIOR (banking tx create → inventory
quantity update). Skillify has NO seam for it, so gemma improvised with
create_mockup (designed a "Verknüpftes Lager" screen — wrong layer entirely).

What the architecture already allows: a sandbox code actor with caps ['ops']
can call ANY named op — `transaction.list` AND `item.list`/`item.update` — so a
reconciler actor is possible TODAY with zero engine changes. What's missing:

1. **The authoring seam**: `connect_skills` (or a widened improve_code) — GLM
   writes the connector's sandbox code given BOTH skills' op contracts +
   example shapes; smoke-gated against stub ops (the proven wireSkill pattern);
   stored as an actor row (which skill owns it? likely the SOURCE skill, e.g.
   banking, with a flow edge into the target).
2. **The trigger**:
   - v1 CALLABLE: a chat tool ("gleich das Lager ab") + a steering line in the
     source skill's crud mailbox ("after recording purchases/sales, offer to
     run the inventory sync"). No engine changes.
   - v2 REACTIVE: data-event flow edges — a create through `<type>.create` fires
     the connector actor automatically (the 0083 actor-model event direction).
     Needs a post-write hook in the ops engine + a flow-run execution seam;
     REAL engine work, own discovery.
3. **Honest gap steering**: until the seam exists, the skillify Tier-3 hint
   should tell the model that cross-skill automation is NOT yet supported so it
   says so instead of improvising with mockup tools.

## Constraints carried over

Sandbox caps stay fail-closed (ops only, both schemas explicitly granted —
maybe caps become `['ops:transaction', 'ops:item']` scoped per schema?);
smoke gate mandatory; no fuzzy resolution; everything config-as-data.

## Decisions (Samuel, 2026-07-04)

- **SUB-SKILL COMPOSITION IS THE ARCHITECTURE**: skills stack into each other
  recursively — the composite/leaf pattern. The flow model ALREADY carries the
  seat (board 0083): a node is a LEAF (actor) XOR a COMPOSITE (flowRef → another
  flow); sub-flow spans nest via parentSpanId; the explorer renders composites
  as group boxes. The connector is the first cross-skill user of that seat: the
  source skill's flow gains a composite node flowRef→target skill, unbounded
  stacking by construction.
- Connector OWNED by the source skill (banking owns "sync inventory"); the
  target is referenced through its PUBLIC surface (its named ops) — delegation
  exactly like mint_data → Ontology caps.
- CAPS SCOPED PER SCHEMA: the connector gets ['ops:<srcType>', 'ops:<tgtType>'],
  never blanket 'ops'. buildCaps enforces the prefix fail-closed. New promoted
  overview actors also get scoped caps from birth (least privilege).
- v1 CALLABLE (a chat tool on the source skill); v2 reactive data-event edges =
  own follow-on card.
- Schemas derived DETERMINISTICALLY: quoted names in the skill's own crud
  mailbox config ∩ types with a `<type>.list` op — no fuzzy matching.
- GLM authors ONLY the connector code (config prompt on the connect_skills
  actor row, ENGINE FACTS included), smoke-gated against stub ops for BOTH
  schemas before the row lands.

## Progress log

- `2026-08-14` — Aus `review/` nach `ship/` archiviert (Sammel-Aktion, Vor-Strip-Ära). Kriterium war die Epoche, nicht eine Einzelprüfung: diese Arbeit ist abgeschlossen — entweder in Produktion gelaufen oder später von 0099/0121 wieder herausgestrippt. Die Karte bleibt hier als historischer Record.
- `2026-07-04` — BUILT green in one pass, architected per Samuel's directive as
  the COMPOSITE SUB-SKILL pattern (recursive skill stacking): the flow model's
  existing leaf/composite seat (board 0083: actor XOR flowRef, nested spans,
  group-box rendering) gets its first cross-skill occupant. (1) SCOPED ops caps
  in buildCaps — 'ops:<type>' grants ONLY that schema's named ops, fail-closed
  error naming the scopes; bare 'ops' stays legacy; new promoted overview actors
  get least-privilege scoped caps from birth. (2) connectSkills(): deterministic
  schema derivation (quoted names in the skill's own crud config ∩ the
  `<type>.list` ops registry) → op contracts + sample rows → GLM connector seam
  (prompt = connect_skills actor row config, idempotence + summary contract) →
  smokeRunConnector gate (stub ops for BOTH schemas; scope escapes throw) →
  actor row on the SOURCE skill (caps ['ops:src','ops:tgt'], refresh-on-
  reconnect) + the composite flowRef node into the source's flow (add-only
  merge, mergeFlowPieces extracted as the ONE flow write path). (3)
  connect_skills tool on skillify (migration 0102: actor row …0113d3 + prompt
  config + skillify flow node). Tests: scoped-caps allow/deny, smoke refusals
  (missing summary · scope escape), end-to-end seam-fixed connector (actor row
  caps asserted, LIVE runCodeActor run over real scoped caps, flowRef node
  present), honest errors (unknown skill · self-connect). betterauth 114/0 ×2 ·
  tsc · svelte-check clean · migration applied to dev. Remaining: Samuel's live
  banking→inventory loop ("connect banking to inventory: Käufe erhöhen den
  Bestand, Verkäufe mindern ihn") + v2 reactive data-event edges (follow-on).

- `2026-07-04` — LIVE LOOP LANDED (three rounds of engine hardening, connector
  100% GLM-authored throughout): round 1 died on a flat 120s timeout (→ streamed
  authoring, idle+total aborts); round 2 exposed the REAL sandbox contract — an
  asyncified cap can only suspend during the MAIN eval, so any cap call after an
  await never settles and pumping jobs across a suspension corrupts the WASM (→
  actors are PLAIN SYNCHRONOUS, caps.ops() blocks; static async/await/Promise
  gate; per-slice interrupt refuel; matrix-proven incl. legacy single-await);
  round 3 WIRED: sync_inventory on banking-overview, caps
  [ops:transaction, ops:inventory], sync-style GLM reconciler (by-name index,
  update-over-create), flow = …improve, sync_inventory, sub-inventory→[inventory]
  (the composite flowRef seat, live). Samuel's first "sync inventory" chat run =
  the remaining HITL confirmation.

- `2026-07-05` — v2 REACTIVE + live feedback (Samuel: "directly connected to the
  incoming and outgoing tx" + the dead-Thinking connect): (1) TRIGGERS AT THE
  CRUD SEAM — connector actor rows ARE the registrations: any sync_* sandbox
  actor whose scoped caps include ops:<schema> FIRES after every crud WRITE to
  that schema; summaries ride the result + the chat reply ("Added 1 … 3
  Positionen aktualisiert."); no recursion (connectors write via runNamedOp,
  not crud); failures reported never swallowed; REST path triggers too.
  (2) connect_skills authoring now STREAMS its GLM tokens into the live panel
  (mockup/website pattern) incl. a "— Korrekturrunde —" marker; promoteCaps
  carries onToken from the chat emitter. Tests: reactive fire asserted at the
  seam (crud create → sync_todos summary in triggered[]). 114/0 ×2 · tsc ·
  svelte-check clean.

- `2026-07-05` — BI-DIRECTIONAL + the detailed author prompt (Samuel): the
  trigger seam was already two-way by construction (caps subscribe BOTH
  schemas) — now the AUTHOR knows it: the connect prompt (config, migration
  0105) teaches the full trigger contract (msg.trigger.schema branching:
  forward reconcile · reverse reconcile or honest no-op · manual full sync),
  the contracts fed to GLM carry each skill's own data rules (crud
  descriptions incl. improve_skill-earned wording — the German-numbers rule
  reaches the connector author), and the smoke gate runs ALL THREE call paths.
  114/0 (×3 consecutive; one Neon flake) · tsc clean.

- `2026-07-05` — DEBUGGED + re-authored under the hardened gate: the live "0
  Inventarartikel erstellt" was GLM reading `.items` off { rows } list results
  + batch {items} on single-row mutation ops — both now impossible (op-shape
  prompt 0106 + structural smoke refusals: strict stubs, must-read-data check).
  GLM re-authored in 181s, first try, verified: reads .rows · single-row
  mutations · sync style · trigger-direction branches · mirror row on inventory
  refreshed. One transient GLM stream stall on the way surfaced honestly via
  the 45s idle abort (the exact failure that used to wedge "Thinking…").
