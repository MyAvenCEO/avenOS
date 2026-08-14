/**
 * Intents — der kleinste denkbare Skill auf dem Rezept-Modell.
 *
 * Er existiert, um das Modell selbst zu prüfen: eine Quelle, eine
 * Klassifikation, eine Weiche, drei Ausgänge. Wo die Buchhaltung mit
 * Subflows, Vier-Augen-Ketten und einem eigenen Export arbeitet, hat
 * dieser Skill genau EINEN flachen Flow ohne Subflow und ohne
 * Skill-Grenze — was übrig bleibt, wenn man alles Fachliche wegnimmt.
 *
 * Zwei Vereinfachungen sind Absicht, nicht Nachlässigkeit:
 *
 * - **Der Mensch sitzt IM Flow**, nicht hinter einer Skill-Grenze. Todo
 *   und Unbekanntes laufen auf `hitl`-Knoten im selben Rezept statt per
 *   `handoff` an den HITL-Skill. Für einen Test-Skill ist die Übergabe
 *   Zeremonie; der generische HITL-Skill bleibt der Weg, sobald mehrere
 *   Skills dieselbe Warteschlange teilen sollen.
 * - **Das Ideen-Board ist eine Liste, keine Notiz.** Der Unterschied ist
 *   der ganze Witz der Triage: die Notiz war der Eingang, der Eintrag auf
 *   dem Board ist das Ergebnis — sonst hätte man nur umbenannt.
 *
 * (Dateiort: das Verzeichnis heißt noch `fibu/`, trägt aber längst das
 * generische Modell — ein Rename nach `flows/` ist die naheliegende
 * Folgearbeit, sobald der zweite Nicht-Fibu-Skill dazukommt.)
 */

import type { Recipe } from './recipe-config'
import type { Skill } from './skill-config'

export const intentsTriage: Recipe = {
	id: 'intents-triage',
	name: 'Intents-Triage',
	description:
		'Eine Notiz kommt rein und bekommt genau ein Etikett: Idee, Todo oder Unbekanntes. Ideen landen auf dem Board, Todos und Unklares gehen an einen Menschen — im selben Flow, ohne Umweg über einen anderen Skill.',
	nodes: [
		{
			id: 'in-notiz',
			kind: 'input',
			name: 'Notizen',
			description:
				'Der Eingang: freier Text, wie er beim Denken entsteht — ein Satz, ein Fetzen, ein halber Gedanke.',
			transform: {
				type: 'source:notes',
				config: { felder: ['text', 'erfasst'], format: 'freitext' }
			},
			inputs: [],
			outputs: [{ name: 'notiz' }]
		},
		{
			id: 'klassifizieren',
			kind: 'transform',
			name: 'Einordnen',
			description:
				'Genau ein Etikett pro Notiz. Was sich nicht klar als Idee oder Todo lesen lässt, ist unbekannt — die Klasse ist ein Urteil, kein Rateversuch.',
			transform: {
				type: 'llm:classify',
				config: {
					klassen: ['idee', 'todo', 'unbekannt'],
					fallback: 'unbekannt',
					ausgabe: { intent: 'klasse', notiz: 'unverändert' }
				}
			},
			llm: {
				purpose:
					'Ordnet eine freie Notiz genau einer der drei Klassen zu — Idee, Todo oder Unbekanntes — und lässt den Text dabei unangetastet.',
				constraints: [
					'Genau eine Klasse pro Notiz — keine Mehrfachzuordnung, keine Zwischenstufen.',
					'Nur die drei deklarierten Klassen; alles Zweifelhafte ist "unbekannt" statt geraten.',
					'Die Notiz wird nicht umformuliert, gekürzt oder ergänzt — es kommt nur ein Etikett dazu.'
				]
			},
			autonomie: {
				modus: 'stichprobe',
				freigabe: {
					durch: 'samuel',
					seit: '2026-08-14',
					nachweis:
						'Ein Etikett ohne Nebenwirkung: die Notiz bleibt unverändert, jede Fehleinordnung ist auf dem Board sofort sichtbar und in einem Klick korrigiert.'
				},
				fehler: 'hitl'
			},
			inputs: [{ name: 'notiz' }],
			outputs: [{ name: 'intent' }]
		},
		{
			id: 'weiche',
			kind: 'route',
			name: 'Intent-Weiche',
			description:
				'Genau ein Zweig feuert pro Notiz — das Etikett aus dem vorherigen Schritt entscheidet, sonst niemand.',
			transform: {
				type: 'route:intent',
				config: {
					nach: 'intent',
					zweige: {
						idee: 'Etwas, das man bauen oder verfolgen könnte.',
						todo: 'Etwas, das getan werden muss — gegengezeichnet von einem Menschen, bevor es zählt.',
						unbekannt: 'Alles Übrige — bewusst kein vierter Zweig, sondern der Auffangzweig.'
					}
				}
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'system',
					seit: '2026-08-14',
					nachweis:
						'Reine Verzweigung auf einem bereits gefällten Urteil — die Weiche entscheidet nichts selbst.'
				},
				fehler: 'hitl'
			},
			inputs: [{ name: 'intent' }],
			outputs: [{ name: 'idee' }, { name: 'todo' }, { name: 'unbekannt' }]
		},
		{
			id: 'als-idee-anlegen',
			kind: 'transform',
			name: 'Als Idee anlegen',
			description:
				'Aus der Notiz wird ein Listeneintrag: Titel, Ursprungstext, Datum. Das ist der eigentliche Übergang — Eingang wird Ergebnis.',
			transform: {
				type: 'list:append',
				config: {
					liste: 'ideen-board',
					felder: ['titel', 'notiz', 'erfasst'],
					idempotent_ueber: 'notiz-id'
				}
			},
			autonomie: {
				modus: 'auto',
				freigabe: {
					durch: 'system',
					seit: '2026-08-14',
					nachweis:
						'Anhängen an eine Liste, idempotent über die Notiz-Id — doppelte Läufe erzeugen keinen zweiten Eintrag, und Löschen stellt den Zustand davor her.'
				},
				fehler: 'retry'
			},
			inputs: [{ name: 'idee' }],
			outputs: [{ name: 'eintrag' }]
		},
		{
			id: 'out-board',
			kind: 'output',
			name: 'Ideen-Board',
			description:
				'Eine Liste, keine Notizsammlung: was hier steht, ist bereits als Idee erkannt und wartet auf eine Entscheidung, nicht auf eine Einordnung.',
			transform: {
				type: 'sink:list',
				config: { liste: 'ideen-board', ansicht: 'liste', sortierung: 'erfasst-absteigend' }
			},
			inputs: [{ name: 'eintrag' }],
			outputs: []
		},
		{
			id: 'todo-bestaetigen',
			kind: 'hitl',
			name: 'Todo bestätigen',
			description:
				'Der Mensch im Flow: das erkannte Todo steht mit seiner Notiz auf einer Karte und zählt erst, wenn es jemand übernimmt. Nichts läuft hier von allein weiter.',
			transform: {
				type: 'hitl:inline',
				config: {
					rolle: 'ich',
					karte: ['notiz', 'todo'],
					aktionen: ['übernehmen', 'verschieben', 'verwerfen'],
					warteschlange: 'im-flow'
				}
			},
			inputs: [{ name: 'todo' }],
			outputs: [{ name: 'erledigt' }]
		},
		{
			id: 'unklares-einordnen',
			kind: 'hitl',
			name: 'Unklares einordnen',
			description:
				'Der Auffangzweig endet bei einem Menschen, nicht in einem Papierkorb: er vergibt die Klasse von Hand oder verwirft die Notiz bewusst.',
			transform: {
				type: 'hitl:inline',
				config: {
					rolle: 'ich',
					karte: ['notiz'],
					aktionen: ['als-idee', 'als-todo', 'verwerfen'],
					warteschlange: 'im-flow'
				}
			},
			inputs: [{ name: 'unbekannt' }],
			outputs: [{ name: 'erledigt' }]
		},
		{
			id: 'out-erledigt',
			kind: 'output',
			name: 'Vom Menschen erledigt',
			description:
				'Der gemeinsame Ausgang beider Gates. Der Port ist ein Entweder-oder: pro Notiz kommt genau eine Entscheidung an, nie zwei.',
			transform: {
				type: 'sink:log',
				config: { protokoll: 'intents-entscheidungen', felder: ['notiz', 'aktion', 'wer', 'wann'] }
			},
			inputs: [{ name: 'erledigt', mode: 'any' }],
			outputs: []
		}
	],
	edges: [
		{ id: 'it1', from: 'in-notiz', fromPort: 'notiz', to: 'klassifizieren', toPort: 'notiz' },
		{ id: 'it2', from: 'klassifizieren', fromPort: 'intent', to: 'weiche', toPort: 'intent' },
		{ id: 'it3', from: 'weiche', fromPort: 'idee', to: 'als-idee-anlegen', toPort: 'idee' },
		{
			id: 'it4',
			from: 'als-idee-anlegen',
			fromPort: 'eintrag',
			to: 'out-board',
			toPort: 'eintrag'
		},
		{ id: 'it5', from: 'weiche', fromPort: 'todo', to: 'todo-bestaetigen', toPort: 'todo' },
		{
			id: 'it6',
			from: 'weiche',
			fromPort: 'unbekannt',
			to: 'unklares-einordnen',
			toPort: 'unbekannt'
		},
		{
			id: 'it7',
			from: 'todo-bestaetigen',
			fromPort: 'erledigt',
			to: 'out-erledigt',
			toPort: 'erledigt'
		},
		{
			id: 'it8',
			from: 'unklares-einordnen',
			fromPort: 'erledigt',
			to: 'out-erledigt',
			toPort: 'erledigt'
		}
	]
}

export const intentsSkill: Skill = {
	id: 'intents',
	name: 'Intents',
	description:
		'Der kleinste Triage-Skill: Notizen rein, ein Etikett drauf — Idee, Todo oder Unbekanntes. Ideen landen auf dem Ideen-Board, Todos und Unklares gehen an einen Menschen, der im Flow selbst sitzt. Ein Flow, keine Subflows, keine Skill-Grenze: das Modell auf seiner kleinsten sinnvollen Stufe.',
	flows: ['intents-triage'],
	entry: 'intents-triage',
	accepts: ['notiz'],
	provides: ['idee']
}
