---
title: Multi-Instanz-Actors — UUID-Identität, Metadaten-Discovery, Engine-Spawn
summary: Ein Manifest = Template, n Instanzen mit eigener Session/State; Identität = globale UUID, Auffindbarkeit = Registry-Metadaten (das Modell jongliert nie UUIDs), spawn/dispose = Engine-Primitive, Fenster pro Instanz dynamisch; Beweis = zweite Task-Liste per Voice
owner: Claude Code (build agent)
created: 2026-08-12
updated: 2026-08-12
tags: [actors, instances, identity, architecture]
goal: "`cd app && bun test tests/instances.test.ts` exits 0 — proving (1) IDENTITY: every instance carries a global uuid and the bus routes envelopes by it; (2) DISCOVERY: registry_list returns template AND instance rows (uuid, template id, name, tags) and instances are findable by metadata, never by guessing uuids; (3) ENGINE PRIMITIVES: spawn(template, name?) creates a second workitems instance with its OWN session and state (uuid differs, reduces diverge — asserted), dispose(uuid) removes it; both are registry entries reachable by message like everything else; (4) WINDOWS: a spawned instance gets its windows from manifest.vibe/vibes titled by instance name, dispose removes them; AND `cd app && bun test` plus `bun run check` (0 errors) stay green"
---

# Multi-Instanz-Actors — UUID-Identität, Metadaten-Discovery, Engine-Spawn

## Context

Heute existiert implizit genau EINE Instanz pro Actor-Template: das Manifest ist
die Klasse, `vibeState` + Session sind die eine Instanz, Ids sind menschenlesbare
Singleton-Namen (`workitems`). Samuels Ziel (2026-08-12): das echte
Template/Instanz-Modell — ein Manifest, n laufende Instanzen.

**Entschieden im Discover-Interview (Samuel):**

1. **Identität = globale UUID, Discovery = Metadaten.** Jede Instanz (und jedes
   Template) trägt eine UUID als Bus-Identität; die Registry macht beides über
   Metadaten auffindbar (template id, name, tags). Skaliert auf tausende Actors
   und deckt sich mit aven-db (Row-UUIDs) und abject (kryptografische Identität +
   dauerhafter TypeId). WICHTIG fürs Modell: Tools behalten Template-Namen
   (`workitem_create`) mit optionalem `instance`-Parameter; UUIDs kommen IMMER
   aus einer Registry-Abfrage, nie aus Modell-Fantasie.
2. **Lebenszyklus = Engine-Primitive.** `spawn`/`dispose` sind Registry-Entries
   (Interface wie alles andere) — die Stimme sagt „mach mir eine Liste für den
   Umzug", das Modell ruft den Entry, die ENGINE führt aus. Kein separater
   UI-Mechanismus nötig (die Instance-Lens zeigt und nutzt dieselben Entries).
3. **Fenster pro Instanz, dynamisch.** Spawn erzeugt die Fenster der Instanz aus
   `manifest.vibe`/`vibes`, Titel = Instanzname; Dispose räumt sie ab. Die
   Ein-Fenster-Bühne bleibt.
4. **Proving-Slice: zweite Task-Liste per Voice.** Die fertigste Vertikale
   beweist alles: eigene Session, eigener State, eigenes Fenster, CRUD per
   Stimme UND Klick, beide Instanzen in der Instance-Lens (als Liste).

Rückwärtskompatibilität: jedes Template hat eine Default-Instanz (die heutige);
ohne `instance`-Parameter meinen Tools weiterhin sie. Menschenlesbare
Template-Ids bleiben als Metadatum — die UUID ist die Identität darunter.

## Goal

Ein Manifest, n Instanzen: UUID-identifiziert, metadaten-auffindbar, von der
Engine gespawnt/entsorgt, jede mit eigener Sandbox-Session, State und Fenstern —
bewiesen mit einer zweiten Task-Liste.

**Completion condition** (identisch zum Frontmatter-`goal`):

> `cd app && bun test tests/instances.test.ts` exits 0 — proving (1) IDENTITY: every instance carries a global uuid and the bus routes envelopes by it; (2) DISCOVERY: registry_list returns template AND instance rows (uuid, template id, name, tags) and instances are findable by metadata, never by guessing uuids; (3) ENGINE PRIMITIVES: spawn(template, name?) creates a second workitems instance with its OWN session and state (uuid differs, reduces diverge — asserted), dispose(uuid) removes it; both are registry entries reachable by message like everything else; (4) WINDOWS: a spawned instance gets its windows from manifest.vibe/vibes titled by instance name, dispose removes them; AND `cd app && bun test` plus `bun run check` (0 errors) stay green.

## Approach

1. **Identity layer** (`actor.ts`/`bus.ts`): Actor bekommt `uuid` (crypto.randomUUID
   beim Konstruieren; Default-Instanzen stabil über den Singleton). Der Bus
   registriert nach uuid UND behält den Template-Namen als Metadatum; `get()`
   löst beides auf (Name → Default-Instanz).
2. **Registry-Metadaten**: `LIST` liefert Templates + Instanzen (uuid, template,
   name, tags, live); neue Entries `spawn` (event SPAWN, Cap `spawn`) und
   `dispose` (event DISPOSE, Cap `dispose`) — Engine-Primitive als Interface.
3. **VibeActor-Instanzen**: `spawn(template, name?)` konstruiert eine weitere
   VibeActor-Instanz aus demselben Manifest (eigene Session, eigener State),
   Tool-Adapter der Instanz binden mit `instance`-Routing statt neuer Toolnamen.
4. **Fenster**: der Windows-Layer hört auf spawn/dispose (Registry-Hooks) und
   erzeugt/entfernt Instanz-Fenster mit Instanznamen.
5. **Explorer**: Instance-Lens = Liste der Instanzen des gewählten Templates
   (uuid kurz, Name, State-Zusammenfassung), spawn/dispose über die normalen
   Entries.
6. **Chat-Prompt**: ein Satz zu Instanzen („'mach eine zweite Liste' = spawn;
   ohne Nennung gilt die Default-Instanz").

Out of scope: Persistenz der Instanzen über Reload (aven-db-Territorium),
Instanz-Migration/Umbenennung, per-Spark-Instanzen (Folge-Slice), P2P.

## Steps

1. `uuid` auf Actor + Bus-Routing (Name→Default bleibt); Tests.
2. Registry LIST mit Instanz-Zeilen + spawn/dispose-Entries (Caps); Tests.
3. Windows-Hooks für Instanz-Fenster; Instance-Lens als Instanzliste.
4. Chat-Prompt-Satz; Voice-E2E in der App (HITL).

**Checkpoint nach Schritt 2** — Engine kann spawnen und die zweite Instanz
divergiert beweisbar; erst dann Fenster/UI.

## Files to touch

- `app/src/lib/actors/actor.ts` (uuid), `bus.ts` (Routing + Auflösung)
- `app/src/lib/actors/registry.actor.ts` (LIST-Metadaten, spawn/dispose)
- `app/src/lib/actors/vibe.actor.ts` (Instanz-Konstruktion, instance-Param)
- `app/src/lib/actors/windows.ts` (Instanz-Fenster), `ActorExplorer.svelte`
  (Instance-Lens als Liste)
- `app/src/lib/chat/chat.svelte.ts` (Prompt-Satz)
- `app/tests/instances.test.ts` (neu — der Beweis)

## Acceptance criteria

- [ ] Jede Instanz trägt eine UUID; Envelope-Routing per UUID, Template-Name löst auf die Default-Instanz. (Test)
- [ ] registry_list zeigt Templates UND Instanzen mit Metadaten; Instanzsuche über Metadaten. (Test)
- [ ] spawn/dispose sind Registry-Entries; zweite workitems-Instanz hat eigene Session + eigenen State (Reduces divergieren). (Test)
- [ ] Instanz-Fenster entstehen/verschwinden mit spawn/dispose, Titel = Instanzname. (Test)
- [ ] `cd app && bun test` + `bun run check` grün.
- [ ] **(HITL)** „Mach mir eine zweite Liste für den Umzug" → neues Listenfenster per Stimme, beide Listen unabhängig per Klick UND Stimme bedienbar, Instance-Lens listet beide.

## Verification

```bash
cd app && bun test tests/instances.test.ts
```

```bash
cd app && bun test && bun run check
```

## Hand-off

```
/aven-build 0133
```

## Progress log

Newest entry first.

- `2026-08-12` — Discovery mit Samuel (Interview): Identität = globale UUID + Metadaten-Discovery über die Registry (Modell jongliert nie UUIDs — Template-Toolnamen + optionaler instance-Param, UUIDs stets aus Registry-Abfragen); spawn/dispose = Engine-Primitive als normale Registry-Entries (Voice äußert die Absicht, die Engine führt aus); Fenster pro Instanz dynamisch aus manifest.vibe/vibes; Proving-Slice = zweite Task-Liste per Voice. Messbar via `tests/instances.test.ts` (Identity · Discovery · Engine-Primitive mit divergierenden Reduces · Instanz-Fenster). Karte direkt in `discover/` angelegt; 0132 behält die Rest-Sandbox-Migrationen.
