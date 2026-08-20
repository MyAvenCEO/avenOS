---
title: Eine Architektur — ALLE Actors sandboxed, Mehrfach-Instanzen pro Manifest
summary: Kein System-Actor-Sonderweg mehr; die Restmigrationen (Windows-Toggle, LLM-Actor, Chat/Listener/Speaker-Steuerlogik) auf VibeActor+Caps, plus Instanz-Modell (ein Manifest, n Instanzen mit eigener Session/State, adressierbar)
owner: unassigned
created: 2026-08-12
updated: 2026-08-12
tags: [actors, sandbox, capabilities, architecture]
---

# Eine Architektur — ALLE Actors sandboxed, Mehrfach-Instanzen pro Manifest

## Context

Entscheidung (Samuel, 2026-08-12): **keine Unterscheidung zwischen Vibe- und
System-Actors** — abweichend von abjects Depths/Containment-Split läuft bei uns
JEDE Actor-Logik in der QuickJS-Sandbox; der Host existiert nur als granted
Capabilities (fail-closed) und als Renderer.

Bereits gelandet (0130-Follow-ups): asyncified Sandbox (`newAsyncifiedFunction`
+ `evalCodeAsync`, das 0111-Rezept) mit `cap(name, payload)`-Tür, Fuel mit
Suspension-Gutschrift, `Manifest.capabilities` als Grants, und die **Registry
als erster migrierter System-Actor** (LIST/DESCRIBE/RUN als Logic; Caps
`actors`/`manifest`/`satisfy`; Tests beweisen async-Suspension + fail-closed).

## Idea

**Slice A — Restmigrationen** (Muster steht, pro Actor ~1h):

- **WindowActor**: Toggle-Verhalten (`open`-Übergang + Solo-Regel) als Logic;
  Cap `windows.solo` schließt die anderen; `open` bleibt als $state-Spiegel.
- **LlmActor**: Validierung/Settings-Shaping als Logic; Cap `proxy.complete`
  ist der einzige fetch.
- **Chat/Listener/Speaker**: die STEUER-Zustandsmaschinen (Status-Übergänge,
  Barge-in-Regeln, Reconnect-Logik) als Logic; Audio-I/O, SSE-Stream und
  Tauri-IPC bleiben physikalisch Caps (`mic.*`, `tts.*`, `chat.stream`).

**Slice B — Mehrfach-Instanzen pro Manifest** (Samuels Punkt): heute existiert
implizit genau EINE Instanz pro Actor. Ziel: ein Manifest = Template, n
Instanzen — jede mit eigener VibeSession + vibeState, adressierbar
(`workitems#2` o.ä.), Envelope-Routing auf Instanz-Ebene, Registry listet
Instanzen pro Template, Instance-Lens im Explorer wird eine LISTE der
laufenden Instanzen (spawn/dispose). Beispiel-Vertikale: zweite Task-Liste
oder pro-Spark-Instanzen.

Offene Designfragen für discover: Instanz-Id-Schema und Default-Instanz
(Rückwärtskompatibilität der Tool-Namen), Fenster↔Instanz-Bindung,
Lebenszyklus (wer spawnt/disposed — Voice? UI? Engine?).
