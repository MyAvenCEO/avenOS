---
title: Cross-skill connector actors — "every banking tx updates inventory"
summary: A skillify seam that authors CONNECTOR actors — GLM-written sandbox code with ops caps over TWO skills' schemas (smoke-gated), plus the trigger question (callable v1 vs data-event flow edges v2).
owner: claude-code
created: 2026-07-04
updated: 2026-07-04
tags: [skillify, actors, flows, cross-skill]
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

## Next

/aven-discover — interview: ownership of the connector (source skill vs a new
"connections" surface), caps scoping per schema, v1-callable vs v2-reactive
slice cut, and the UX ("nach jedem Kauf fragen" vs silent sync).
