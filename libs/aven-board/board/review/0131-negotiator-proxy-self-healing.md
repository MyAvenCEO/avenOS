---
title: Negotiator — inkompatible Actors verhandeln ihre Brücke (Ask-Protokoll Stufe 2)
summary: Ein Negotiator-Actor interviewt zwei vokabular-inkompatible Actors per caller-aware ask(), lässt die Modell-Lane eine Proxy-Logic (QuickJS) schreiben, zeigt den Draft in seiner EIGENEN View (HITL-Gate) und registriert den Proxy als Session-Actor mit Code-Export; Self-Healing = eigene Folgekarte
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, ask-protocol, negotiation, sandbox]
goal: "`cd app && bun test tests/negotiator.test.ts` exits 0 — proving with a FAKED llm actor: (1) INTERVIEW: negotiate(from, to) asks BOTH actors via ask() with asker='negotiator' (caller-awareness asserted in the fake's seen system prompts) and hands their answers plus both contracts to the model lane; (2) DRAFT + GATE: the returned proxy (logic + description) is held as a PENDING draft — nothing joins the mesh before negotiator_approve; reject discards; (3) BRIDGE: after approve, the registered proxy is a normal sandboxed logic-actor whose contract is requires=[producer's produces], produces=[consumer's requires], and bus.satisfy() chains producer → proxy → consumer end-to-end (diverging vocabularies actually bridged, asserted on the consumer's received payload); (4) EXPORT: approve returns a catalog-ready code snippet (manifest+logic as TypeScript) in the record — definitions stay code-ownable; (5) malformed model output = structured failure, no pending draft; AND `cd app && bun test` plus `bun run check` (0 errors) stay green; the live demo pair (metric producer / imperial consumer) ships in the catalog and the negotiator paints its own review view — verified HITL in the app"
---

# Negotiator — inkompatible Actors verhandeln ihre Brücke

## Context

Ask-Protokoll Stufe 2 (abject: Negotiator/ProxyGenerator — „reads two
incompatible manifests and conjures a living proxy between them, a real Abject,
not a shim"). Vorarbeit liegt komplett: caller-aware `ask()`, der LLM-Actor als
einzige Modelltür, die asyncified Caps-Sandbox, Multi-Instanz mit UUID-Routing,
`send`-Primitiv.

**Entschieden im Discover-Interview (Samuel, 2026-08-12):**

1. **Beweis = Test-Paar + Live-Demo-Paar.** Deterministisch in bun mit gefaktem
   LLM (zwei synthetische Actors mit Vokabular-Mismatch); zusätzlich ein echtes
   Demo-Paar im Katalog — Producer spricht `metric(M)` (z.B. {km}), Consumer
   braucht `imperial(I)` (z.B. {miles}) — damit die echte Negotiation mit echtem
   Modell in der App sichtbar ist.
2. **HITL-Gate = eigene Negotiator-VIEW.** Der Negotiator malt sein Gesicht
   selbst (dogfoodet das View-System): pending Draft mit generierter Logic
   sichtbar, Approve/Reject als View-Events — zusätzlich als Entries per Stimme
   erreichbar. „Code ist die Wahrheit": NICHTS betritt die Mesh vor Approve.
3. **Self-Healing: aufgeschoben.** 0131 = Negotiate + Gate + Bridge; der
   heal-Flow (Fehlerhistorie → Re-Draft) wird eine eigene Karte, sobald Proxies
   real laufen.
4. **Lebensdauer = Session + Code-Export.** Der approvte Proxy läuft sofort in
   der Session; der Approve-Record enthält einen katalog-fertigen
   TypeScript-Schnipsel (Manifest + Logic), den ein Mensch committet, wenn die
   Brücke bleiben soll. Kein localStorage.

Dazu passend heute schon gelandet: `goal_run` aus der Registry eliminiert (das
manuelle Engine-Gateway ging mit dem Proof-Lens), Template-Rename
`workitems → workitem` (singular), Listen-Fenster „Project List".

## Goal

Zwei Actors, die einander nicht verstehen, bekommen per Interview + Modell eine
generierte, sandboxte Brücke — HITL-gated, sofort lauffähig, als Code
exportierbar.

**Completion condition** (identisch zum Frontmatter-`goal`):

> `cd app && bun test tests/negotiator.test.ts` exits 0 — proving with a FAKED llm actor: (1) INTERVIEW via caller-aware ask (asker='negotiator' asserted); (2) DRAFT held pending, nothing registered before approve, reject discards; (3) BRIDGE: approved proxy = sandboxed logic-actor with requires=[producer.produces]/produces=[consumer.requires], and bus.satisfy() chains producer → proxy → consumer with the vocabulary actually translated; (4) EXPORT: approve returns a catalog-ready TS snippet; (5) malformed model output = structured failure; plus full suite + check green; live demo pair + negotiator view verified HITL.

## Approach

1. **`negotiator.actor.ts`** — ein normaler Logic-Actor (id `negotiator`, tags
   [system]): Events NEGOTIATE/APPROVE/REJECT in sandboxter Logic; Caps
   (fail-closed): `describe` (Manifest), `ask` (bus.ask mit asker
   'negotiator'), `complete` (Dispatch an den llm-Actor), `register` (Host baut
   aus dem Draft einen Actor {logic, requires, produces, tags:['proxy']} und
   registriert ihn; liefert uuid + TS-Export-String).
2. **Draft-Zyklus in der Logic:** NEGOTIATE holt beide Manifeste + ask-Antworten,
   komponiert den Design-Prompt, parst die Modellantwort HINTER der Membran
   (Garbage → strukturierter Fehler), hält den Draft im State (`pending`).
   APPROVE ruft cap('register') und legt den Export-Schnipsel ins Record;
   REJECT verwirft.
3. **Negotiator-View** (Manifest `view`/`style`): zeigt Status + pending Draft
   (Beschreibung, Contract, Logic gekürzt) + Approve/Reject-Buttons (`$on` →
   APPROVE/REJECT — dieselben Events wie die Voice-Entries).
4. **Demo-Paar im Katalog:** `metric` (produces metric(M), logic erzeugt {km})
   und `imperial-display` (requires imperial(I), view zeigt miles) — bewusst
   inkompatibel; Chat-Prompt-Satz: „when two actors cannot understand each
   other, negotiate(from, to) drafts a bridge; approve registers it".
5. **Tests** (`negotiator.test.ts`) mit Fake-LLM-Actor (canned Proxy-JSON) —
   exakt die Goal-Punkte; plus Suite/Check.

Out of scope: Self-Healing/HealthMonitor (Folgekarte), P2P-Fremd-Actors,
automatische Negotiation ohne HITL, Persistenz jenseits des Code-Exports.

## Steps

1. Negotiator-Actor + Caps + Logic (NEGOTIATE/APPROVE/REJECT); Fake-LLM-Tests
   für Interview + Gate + Malformed.
2. Bridge-Beweis: synthetisches Paar, satisfy-Kette producer→proxy→consumer.
3. Export-Schnipsel + View (Approve/Reject als View-Events).
4. Demo-Paar in den Katalog + Prompt-Satz; HITL in der App.

**Checkpoint nach Schritt 2** — die Kette läuft im Test; erst dann View/Demo.

## Files to touch

- `app/src/lib/actors/negotiator.actor.ts` (neu)
- `app/src/lib/actors/catalog.ts` (Demo-Paar metric/imperial)
- `app/src/lib/actors/chat.actor.svelte.ts` (Registrierung), `chat.svelte.ts`
  (Prompt-Satz)
- `app/tests/negotiator.test.ts` (neu — der Beweis)

## Acceptance criteria

- [ ] Interview caller-aware: beide ask()-Aufrufe tragen asker='negotiator'. (Test)
- [ ] Gate: vor approve ist NICHTS registriert; reject verwirft; approve registriert. (Test)
- [ ] Bridge: satisfy() kettet producer → proxy → consumer, Vokabular übersetzt (Payload-Assertion). (Test)
- [ ] Export: approve-Record enthält katalog-fertigen TS-Schnipsel. (Test)
- [ ] Malformed Modell-Output = strukturierter Fehler, kein pending Draft. (Test)
- [ ] Suite + Check grün.
- [ ] **(HITL)** Demo-Paar im Katalog; per Stimme „verhandle metric mit imperial" → Draft in der Negotiator-View sichtbar, Approve per Klick ODER Stimme, danach fließen km als miles.

## Verification

```bash
cd app && bun test tests/negotiator.test.ts
```

```bash
cd app && bun test && bun run check
```

## Hand-off

```
/aven-build 0131
```

## Progress log

Newest entry first.

- `2026-08-12` — **Follow-up (Samuel): universelles HITL, button-only.** Neues Primitiv: `MethodSpec.hitl` (imperatives Label) → der Bus HÄLT den Dispatch (`held_…`), die eine HUD-Leiste über der Voice-Pille zeigt Label + Actor + Payload, und NUR ein physischer Button-Press bestätigt — Confirm ist kein Tool, die Stimme kann prinzipbedingt nicht bestätigen (Test: kein confirm-Tool in toolSpecs; headless ohne HUD bleibt offen für Tests). Verdrahtet: workitem_delete, workitem_clear_done, dispose — und die Bridge: negotiator_approve/reject als Voice-Tools GELÖSCHT, Approval nur noch per Button (HUD-Leiste + Fenster-Buttons via uiEvent); Negotiator-Fenster nimmt bei Draft automatisch die Bühne. UI-Klicks umgehen das Gate bewusst (ein Klick IST der Button). Views poliert: Negotiator max-w + Plural, Metric/Imperial als Wert-Karten mit Einheit. Prompt sagt dem Modell die Wahrheit ('never claim you approved'). 70/70, Check 0.

- `2026-08-12` — **HITL-Fund (Samuel, Voice in der App) gefixt:** „kannst du Imperial mit Metric verhandeln" → Modell rief negotiate(imperial-display, metric) → „no contract to bridge". Richtung ist jetzt Sache des Negotiators: produziert `from` nichts, aber `to` schon (und `from` konsumiert), wird das Paar getauscht — Test „direction does not matter" beweist es; Tool-Beschreibung sagt es dem Modell. 67/67.

- `2026-08-12` — **BUILD COMPLETE — alle Goal-Kriterien grün** (`negotiator.test.ts` 6/6, Suite 66/66, Check 0). `negotiator.actor.ts`: Verhandlung als sandboxte Logic (NEGOTIATE/APPROVE/REJECT), vier fail-closed Caps (describe/ask/complete/register); Interview caller-aware (asker='negotiator' im Test bewiesen), Draft strikt pending (nichts in der Mesh vor Approve, Reject verwirft, Garbage → strukturierter Fehler ohne Draft), Approve registriert den Proxy als normalen Logic-Actor (synthesizierter TRANSLATE-Entry → generische Adapter binden ihn als Prolog-Klausel) UND liefert den katalog-fertigen Code-Export. Bridge-Beweis: `satisfy('imperial(I)', {km:100})` kettet metric → generierter Proxy → 62.14 miles; per emit erreicht die Übersetzung den Consumer. Demo-Paar metric/imperial im Katalog, Negotiator-View mit Approve/Reject-Buttons (eigenes Fenster), Chat-Prompt-Satz. Nebenbei-Fix: Event-Entries binden jetzt auch den REQUIRED-Funktor als Emit-Empfänger. Live auf 5182 verifiziert (Mesh zeigt Metric/Imperial/Negotiator). HITL offen: echte Negotiation per Stimme mit echtem Modell in der App.

- `2026-08-12` — Discovery mit Samuel (Interview): Beweis = deterministisches Test-Paar (Fake-LLM) + echtes Demo-Paar metric/imperial im Katalog; HITL-Gate = eigene Negotiator-View (Approve/Reject als View-Events, zusätzlich Voice-Entries); Self-Healing aufgeschoben (eigene Karte); Lebensdauer = Session + katalog-fertiger Code-Export beim Approve. Im selben Zug: goal_run aus der Registry eliminiert (Debug-Gateway, wie der Proof-Lens) und workitems→workitem (singular) + „Project List" umbenannt. Karte ideate→discover.
