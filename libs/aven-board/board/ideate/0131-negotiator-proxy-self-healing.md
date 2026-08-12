---
title: Negotiator + ProxyGenerator + Self-Healing — Ask-Protokoll Stufe 2
summary: Wenn zwei INKOMPATIBLE Actors real aufeinandertreffen (Marketplace-Skill, P2P-Peer), generiert ein Negotiator aus beiden ask()-Selbstbeschreibungen einen lebenden Proxy-Actor; Fehlerhistorie regeneriert ihn (self-healing). Bewusst NICHT vorher bauen.
owner: unassigned
created: 2026-08-12
updated: 2026-08-12
tags: [actors, ask-protocol, deferred]
---

# Negotiator + ProxyGenerator + Self-Healing — Ask-Protokoll Stufe 2

## Context

Beim Abgleich mit abject.world (Karte [[0130]]) blieben drei Ask-Protokoll-Bausteine
bewusst offen: der Negotiator (liest zwei inkompatible Manifeste, erzeugt per LLM
einen Übersetzer), der ProxyGenerator (der Übersetzer ist ein ECHTER Actor, kein
Shim) und Self-Healing (bei degradierender Kommunikation werden frische
usage-guides per ask() geholt und der Proxy mit der Fehlerhistorie regeneriert).

Entscheidung (Samuel + Erstprinzipien-Regeln, 2026-08-12): **nicht jetzt bauen.**
Alle heutigen Actors teilen einen Codebase und ein Contract-Vokabular — es gibt
kein Inkompatibilitätsproblem. Zur Laufzeit generierte Actors widersprächen
außerdem der Composer-Entscheidung („der Katalog im Code ist die Wahrheit"),
solange kein Review-Gate existiert.

**Trigger, der diese Karte aktiviert** (einer reicht):

1. Ein Actor aus fremder Quelle (Marketplace-Skill, Drittanbieter) betritt die Mesh
   und spricht ein anderes Contract-Vokabular.
2. P2P-Actors (RemoteRegistry/PeerRouter-Äquivalent) landen auf der Roadmap.
3. Zwei interne Actors entwickeln real divergierende Schnittstellen, die heute von
   Hand überbrückt werden müssten.

Vorarbeit, die schon liegt: caller-aware `ask()` (der Grundstein der Negotiation —
Actors können einander gezielt interviewen), der LLM-Actor als einzige Modelltür,
und die QuickJS-Sandbox als natürlicher Ort für generierte Proxy-Logic (ein Proxy
wäre ein VibeActor, dessen logic der Negotiator schreibt — HITL-Review vor
Registrierung, damit „Code ist die Wahrheit" hält).

## Idea

Negotiator als System-Actor: `negotiate(a, b)` interviewt beide Seiten per ask(),
lässt die Modell-Lane eine Proxy-`logic` (QuickJS) schreiben, zeigt sie dem
Menschen (Review-Gate), registriert den Proxy als VibeActor mit Contract
`requires: [A-produces]`, `produces: [B-requires]`. HealthMonitor-Äquivalent:
Fehlerrate im Trace über Schwelle → Regeneration mit Fehlerhistorie als Kontext.
