---
title: Chat-UI als Actor-View — die letzte hartkodierte Svelte-Oberfläche
summary: Der Chat-Panel (Turns, Streaming-Bubble, Activity-Zeilen) wird eine View über den Chat-Actor-State (ViewDef/StyleDef + Logic) statt Svelte-Spezialkomponenten; Voraussetzung ist inkrementelles Rendering in der aven-ui-Engine (Token-Streaming rendert heute per Voll-Rebuild)
owner: unassigned
created: 2026-08-12
updated: 2026-08-12
tags: [actors, views, chat, ui]
---

# Chat-UI als Actor-View — die letzte hartkodierte Svelte-Oberfläche

## Context

Nach 0130/0133 malt jeder Actor sein Gesicht als View-Daten — außer dem Chat:
Turns, Streaming-Bubble und Activity-Toasts sind Svelte-Markup in
`dashboard/+page.svelte`. Konsequent wäre: der Chat-Actor trägt `view`/`style`
im Manifest (der Legacy-`chat`-Vibe in `libs/aven-ui/src/vibes/chat/` ist als
Referenz erhalten!), sein State (turns, streaming) ist `state`, und die eine
AvenUiView rendert ihn.

**Der ehrliche Blocker:** die aven-ui-Engine rendert per Voll-Rebuild
(`innerHTML = ''` + Neuaufbau, Fokus-Restore). Token-Streaming (viele Updates/s
während einer Antwort) würde thrashen. Voraussetzung ist inkrementelles
Rendering (keyed `$each`-Diffing oder Text-Node-Patch für den Streaming-Slot) —
ein Engine-Feature, das ALLEN Views zugutekommt.

## Idea

1. Engine-Slice: minimales Diffing (Text-Nodes in-place patchen; `$each` mit
   Item-Keys) + Messung mit synthetischem Token-Stream.
2. Chat-View: `view`/`style` im Chat-Manifest (Startpunkt = Legacy-chat-Vibe,
   auf Brand-Tokens), State-Mapping turns→rows; Activity als eigene View oder
   Teil des Chat-States.
3. `dashboard/+page.svelte` verliert das Chat-Markup — es bleibt Tabs + Rail +
   Fensterfläche + Composer-Input (der Mikro/Text-Eingang ist Hardware-nah und
   bleibt Host).

Messbar später via: kein Chat-Markup mehr in +page.svelte (grep), Streaming
einer langen Antwort ohne Frame-Drops (Perf-Budget), Suite grün.
