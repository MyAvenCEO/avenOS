<script lang="ts">
import { Background, type Edge, type Node, SvelteFlow } from '@xyflow/svelte'
import '@xyflow/svelte/dist/style.css'
import type { HeldPreview } from '$lib/actors/bus'
import { bus } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { hitlQueue } from '$lib/actors/hitl.svelte'
import { registryTick } from '$lib/actors/reactivity.svelte'
import { isWindow } from '$lib/actors/window.actor.svelte'
import FitView from '$lib/mesh/FitView.svelte'
import FlowNode from '$lib/skills/FlowNode.svelte'
import { layoutWorkflow } from '$lib/skills/flow-layout'
import { skillById } from '$lib/skills/registry'
import { talk } from './talk.svelte'

/**
 * The Intents workspace — instances MOCKED (0158), but the skill flows are
 * the REAL templates from the skills registry: template and instance are
 * one source. Three panes in the mail-app reading:
 *
 *   left   — the intent stream (compact cards, cream selection)
 *   center — the ACTIVITY LOG (every entry TYPED by the skill that wrote
 *            it), OR an artifact preview (full width), OR the skill's
 *            ACTUAL workflow rendered as the n8n canvas with the
 *            instance state overlaid on its nodes
 *   right  — SKILLS (click → the instance-on-template flow) above
 *            ARTIFACTS (click → preview)
 *
 * A PENDING HITL never lives in the log alone: it surfaces in the global
 * HITL bar above the voice pill (the one confirm interface); the log
 * keeps the entry as history. Submitted/answered gates stay log lines.
 */

interface LogEntry {
	step: string
	when: string
	state: 'done' | 'running' | 'waiting'
	/** WHICH skill wrote this entry — every log line is typed. */
	skill: string
	note?: string
	/** A rich entry renders as a card on the timeline (like a mail preview). */
	card?: { title: string; text: string }
	/** The waiting entry offers the HITL pair. */
	hitl?: boolean
}
interface MockArtifact {
	kind: 'doc' | 'todo' | 'calendar' | 'person' | 'entity' | 'statement'
	title: string
	note: string
}
interface SkillStatus {
	skill: string
	state: 'done' | 'running' | 'waiting'
	note: string
	/** Which workflow of the TEMPLATE this instance runs. */
	workflow: string
	/** Node ids (of the template workflow) already completed. */
	done: string[]
	/** The node the instance currently sits on, if any. */
	current?: string
}
interface MockIntent {
	id: string
	type: string
	title: string
	source: string
	when: string
	deadline?: string
	status: IntentState
	log: LogEntry[]
	artifacts: MockArtifact[]
	skills: SkillStatus[]
	/**
	 * The gate this intent is holding for the human. A gate can exist in any
	 * state — `waiting` means the intent AS A WHOLE is blocked on it; in the
	 * other states it is one optional confirmation beside work that runs on.
	 */
	hitl?: { label: string; method: string; actor: string; preview: HeldPreview }
}

/**
 * Intent types wear ONE quiet badge, not five coloured ones. Five hues
 * competing down the stream drowned out the thing that actually changes —
 * the 3px state edge — so type is now carried by the WORD alone and colour
 * is spent only where it means something. A map of five identical values
 * would just be a place to start re-colouring, hence a single constant.
 */
const TYPE_BADGE = 'bg-status-quiet/15 text-status-quiet-ink'

/**
 * The five states an intent can be in — each with its own accent, worn as
 * a 3px edge on the card so the stream is readable at a glance.
 */
type IntentState = 'working' | 'waiting' | 'done' | 'error' | 'archive'

const STATUS_LABEL: Record<IntentState, string> = {
	working: 'läuft',
	waiting: 'wartet auf dich',
	done: 'erledigt',
	error: 'Fehler',
	archive: 'archiviert'
}

/**
 * Each state names ITSELF, not a colour and not even a role — `state-working`
 * resolves through app.css block 4, where the state→role mapping lives. So
 * swapping what working and done read as is one line in the theme, not a
 * sweep through this file.
 *
 * edge = the 3px left border, text = the status word (the `-ink` face, which
 * is the tone darkened far enough to be read on cream).
 */
const STATE_ACCENT: Record<IntentState, { edge: string; text: string }> = {
	working: { edge: 'border-l-state-working', text: 'text-state-working-ink' },
	waiting: { edge: 'border-l-state-waiting', text: 'text-state-waiting-ink' },
	done: { edge: 'border-l-state-done', text: 'text-state-done-ink' },
	error: { edge: 'border-l-state-error', text: 'text-state-error-ink' },
	archive: { edge: 'border-l-state-archive', text: 'text-state-archive-ink' }
}

const KIND_LABEL: Record<string, string> = {
	doc: 'PDF',
	todo: 'TODO',
	calendar: 'KAL',
	person: 'WER',
	entity: 'BRAIN',
	statement: 'KONTO'
}

const INTENTS: MockIntent[] = [
	{
		id: 'krankenkasse',
		type: 'frist',
		title: 'Krankenkasse: Nachweis bis 15.09.',
		source: 'Post-Scan · Brief',
		when: 'heute · 09:12',
		deadline: 'bis 15.09.',
		status: 'waiting',
		log: [
			{
				step: 'Brief eingegangen',
				when: '12.08. · 14:02',
				state: 'done',
				skill: 'inbox',
				note: 'Post-Scan · als Artefakt archiviert'
			},
			{
				step: 'Klassifiziert',
				when: '12.08. · 14:02',
				state: 'done',
				skill: 'inbox',
				card: {
					title: 'Krankenversicherung · Frist erkannt',
					text: 'Absender: Techniker Krankenkasse. Gefordert: Einkommensnachweis. Frist: 15.09. — Zuversicht 96 %.'
				}
			},
			{
				step: 'Intent extrahiert',
				when: '12.08. · 14:03',
				state: 'done',
				skill: 'inbox',
				note: '„Nachweis einreichen bis zur Frist" — ein Todo, ein Termin, ein Entwurf'
			},
			{
				step: 'Todo angelegt',
				when: '12.08. · 14:03',
				state: 'done',
				skill: 'todos',
				note: '„Nachweis einreichen" · fällig 12.09. · @me'
			},
			{
				step: 'Kalender-Frist eingetragen',
				when: '12.08. · 14:03',
				state: 'done',
				skill: 'calendar',
				note: '15.09. · ganztägig'
			},
			{
				step: 'Antwortentwurf wartet auf Freigabe',
				when: 'heute · 09:12',
				state: 'waiting',
				skill: 'docs',
				card: {
					title: 'Entwurf: Antwort an die TK',
					text: 'Sehr geehrte Damen und Herren, anbei der angeforderte Einkommensnachweis für den Zeitraum…'
				},
				hitl: true
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'krankenkasse-brief.pdf', note: 'gescannt 12.08. · archiviert' },
			{ kind: 'todo', title: 'Nachweis einreichen', note: 'offen · fällig 12.09. · @me' },
			{ kind: 'calendar', title: 'Frist Krankenkasse', note: '15.09. · ganztägig' },
			{ kind: 'person', title: 'Techniker Krankenkasse', note: 'Firma · Versicherung' },
			{ kind: 'entity', title: '[[Versicherungen 2025]]', note: 'Brain · 4 Verknüpfungen' }
		],
		skills: [
			{
				skill: 'inbox',
				state: 'done',
				note: 'klassifiziert · Intent extrahiert',
				workflow: 'intake',
				done: ['mail-trigger', 'upload-trigger', 'normalize', 'classify', 'route']
			},
			{
				skill: 'todos',
				state: 'done',
				note: '1 Todo angelegt · offen',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view', 'board-view']
			},
			{
				skill: 'calendar',
				state: 'done',
				note: 'Frist 15.09. eingetragen',
				workflow: 'frist',
				done: ['date-trigger', 'schedule'],
				current: 'remind'
			},
			{
				skill: 'docs',
				state: 'waiting',
				note: 'Antwortentwurf wartet auf Freigabe',
				workflow: 'respond',
				done: ['request-trigger', 'draft'],
				current: 'approve'
			},
			{
				skill: 'brain',
				state: 'running',
				note: 'verknüpft mit [[Versicherungen 2025]]',
				workflow: 'verknuepfen',
				done: ['entity-trigger', 'resolve', 'link'],
				current: 'enrich'
			}
		],
		hitl: {
			label: 'Antwortentwurf an die TK freigeben',
			method: 'draft_approve',
			actor: 'docs',
			preview: {
				kind: 'entwurf',
				layout: 'document',
				title: 'An Techniker Krankenkasse · Frist 15.09.',
				body: 'Sehr geehrte Damen und Herren,\n\nanbei der angeforderte Einkommensnachweis für den Zeitraum Januar bis Juni 2025.\n\nMit freundlichen Grüßen\nSamuel Andert',
				attachments: ['einkommensnachweis.pdf']
			}
		}
	},
	{
		id: 'buerostuhl',
		type: 'bezahlen',
		title: 'Rechnung Bürostuhl bezahlen',
		source: 'Upload · Rechnung',
		when: 'heute · 08:44',
		deadline: 'bis 30.08.',
		status: 'working',
		log: [
			{
				step: 'Rechnung hochgeladen',
				when: 'heute · 08:44',
				state: 'done',
				skill: 'inbox',
				note: 'rechnung-buerostuhl.pdf · archiviert'
			},
			{
				step: 'Klassifiziert',
				when: 'heute · 08:44',
				state: 'done',
				skill: 'inbox',
				card: {
					title: 'Rechnung · 249,00 €',
					text: 'Möbelhaus Nord GmbH · Zahlungsziel 30.08. · IBAN erkannt · Skonto: keins.'
				}
			},
			{
				step: 'Todo angelegt',
				when: 'heute · 08:45',
				state: 'done',
				skill: 'todos',
				note: '„Bürostuhl bezahlen — 249 €" · fällig 30.08.'
			},
			{
				step: 'Wartet auf Zahlung',
				when: 'seit heute',
				state: 'running',
				skill: 'abgleich',
				note: 'der nächste Kontoauszug hakt das Todo automatisch ab'
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'rechnung-buerostuhl.pdf', note: '249,00 € · archiviert' },
			{ kind: 'todo', title: 'Bürostuhl bezahlen', note: 'offen · fällig 30.08. · #rechnung' },
			{ kind: 'person', title: 'Möbelhaus Nord GmbH', note: 'Firma · Lieferant' }
		],
		skills: [
			{
				skill: 'inbox',
				state: 'done',
				note: 'klassifiziert als Rechnung',
				workflow: 'intake',
				done: ['mail-trigger', 'upload-trigger', 'normalize', 'classify', 'route']
			},
			{
				skill: 'todos',
				state: 'done',
				note: '1 Todo angelegt · offen',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view', 'board-view']
			},
			{
				skill: 'abgleich',
				state: 'running',
				note: 'wartet auf den nächsten Kontoauszug',
				workflow: 'match',
				done: [],
				current: 'statement-trigger'
			}
		],
		hitl: {
			label: 'Zahlung freigeben',
			method: 'payment_release',
			actor: 'abgleich',
			preview: {
				kind: 'zahlung',
				layout: 'ledger',
				title: 'Möbelhaus Nord GmbH — Rechnung R-2025-8842',
				rows: [
					{ label: 'Betrag', value: '249,00 €' },
					{ label: 'Fällig', value: '30.08.' },
					{ label: 'IBAN', value: 'DE12 3456 7890 1234 5678 00' },
					{ label: 'Von Konto', value: 'Giro · 4.120,55 €' }
				]
			}
		}
	},
	{
		id: 'steuer',
		type: 'steuer',
		title: 'Steuererklärung 2023 zusammenstellen',
		source: 'Dauerauftrag',
		when: 'seit 02.08.',
		deadline: 'bis 30.09.',
		status: 'working',
		log: [
			{
				step: 'Sammel-Intent gestartet',
				when: '02.08.',
				state: 'done',
				skill: 'brain',
				note: 'langlaufend: alles für die Erklärung 2023'
			},
			{
				step: 'Artefakte verknüpft',
				when: 'laufend',
				state: 'done',
				skill: 'brain',
				card: {
					title: '12 Artefakte im Brain',
					text: 'Rechnungen (7), Kontoauszüge (4), Lohnsteuerbescheinigung (1) — jedes neue Dokument wird automatisch zugeordnet.'
				}
			},
			{
				step: 'Todo hält die Frist',
				when: '02.08.',
				state: 'done',
				skill: 'todos',
				note: '„Unterlagen an Steuerberater" · fällig 20.09.'
			},
			{
				step: 'Sammelt weiter',
				when: 'laufend',
				state: 'running',
				skill: 'docs',
				note: 'fehlend laut Checkliste: Spendenquittungen, Handwerkerrechnungen'
			}
		],
		artifacts: [
			{ kind: 'entity', title: '[[Steuer 2023]]', note: 'Brain · 12 Artefakte' },
			{ kind: 'doc', title: 'lohnsteuerbescheinigung-2023.pdf', note: 'archiviert' },
			{ kind: 'statement', title: 'Kontoauszüge Q1–Q4 2023', note: '4 Dateien' },
			{ kind: 'todo', title: 'Unterlagen an Steuerberater', note: 'offen · fällig 20.09.' },
			{ kind: 'person', title: 'StB Kanzlei Meier', note: 'Firma · Steuerberatung' }
		],
		skills: [
			{
				skill: 'brain',
				state: 'running',
				note: '12 Artefakte verknüpft · sammelt weiter',
				workflow: 'verknuepfen',
				done: ['entity-trigger', 'resolve', 'link'],
				current: 'enrich'
			},
			{
				skill: 'todos',
				state: 'done',
				note: 'Frist-Todo angelegt',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view']
			},
			{
				skill: 'docs',
				state: 'running',
				note: 'ordnet neue Dokumente automatisch zu',
				workflow: 'respond',
				done: ['request-trigger'],
				current: 'draft'
			}
		],
		hitl: {
			label: 'Dokument der Steuer 2023 zuordnen',
			method: 'classify_confirm',
			actor: 'brain',
			preview: {
				kind: 'zuordnung',
				layout: 'choice',
				title: 'handwerker-bad-2023.pdf — wohin gehört das?',
				options: [
					{ label: 'Handwerkerleistungen §35a', note: '78 %', chosen: true },
					{ label: 'Erhaltungsaufwand', note: '19 %' },
					{ label: 'Privat — nicht absetzbar', note: '3 %' }
				]
			}
		}
	},
	{
		id: 'umzug',
		type: 'auftrag',
		title: 'Umzugsunterlagen zusammenführen',
		source: 'Freitext · Chat',
		when: 'heute · 10:05',
		status: 'waiting',
		log: [
			{
				step: 'Auftrag erfasst',
				when: 'heute · 10:05',
				state: 'done',
				skill: 'inbox',
				note: '„Sammle alles zum Umzug an einem Ort"'
			},
			{
				step: 'Dublette gefunden',
				when: 'heute · 10:06',
				state: 'waiting',
				skill: 'brain',
				note: 'zwei Einträge für denselben Vermieter — Zusammenführung wartet auf dich'
			}
		],
		artifacts: [
			{ kind: 'entity', title: '[[Umzug 2025]]', note: 'Brain · 9 Verknüpfungen' },
			{ kind: 'person', title: 'Hausverwaltung Berg', note: 'Firma · Vermieter' }
		],
		skills: [
			{
				skill: 'brain',
				state: 'waiting',
				note: 'Dublette wartet auf Zusammenführung',
				workflow: 'verknuepfen',
				done: ['entity-trigger'],
				current: 'resolve'
			}
		],
		hitl: {
			label: 'Doppelten Kontakt zusammenführen',
			method: 'entity_merge',
			actor: 'brain',
			preview: {
				kind: 'dublette',
				layout: 'compare',
				title: 'Ähnlichkeit 88 % — dieselbe Adresse',
				sides: [
					{
						heading: 'Behalten',
						lines: ['[[Hausverwaltung Berg]]', 'Bergstraße 14, Berlin', '9 Bezüge']
					},
					{
						heading: 'Verschmelzen',
						lines: ['[[HV Berg GmbH]]', 'Bergstr. 14, Berlin', '2 Bezüge']
					}
				]
			}
		}
	},
	{
		id: 'stromabrechnung',
		type: 'abgleich',
		title: 'Stromabrechnung 2024 prüfen',
		source: 'Upload · PDF',
		when: 'heute · 08:02',
		status: 'waiting',
		log: [
			{
				step: 'Abrechnung hochgeladen',
				when: 'heute · 08:02',
				state: 'done',
				skill: 'inbox',
				note: 'stromabrechnung-2024.pdf · archiviert'
			},
			{
				step: 'Duplikate erkannt',
				when: 'heute · 08:03',
				state: 'waiting',
				skill: 'docs',
				note: 'drei identische Scans derselben Abrechnung im Archiv'
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'stromabrechnung-2024.pdf', note: '182,40 € Guthaben · archiviert' },
			{ kind: 'person', title: 'Stadtwerke Nord', note: 'Firma · Energie' }
		],
		skills: [
			{
				skill: 'docs',
				state: 'waiting',
				note: '3 Duplikate — Löschung wartet auf dich',
				workflow: 'respond',
				done: ['request-trigger'],
				current: 'approve'
			}
		],
		hitl: {
			label: 'Drei Duplikate löschen',
			method: 'docs_delete',
			actor: 'docs',
			preview: {
				kind: 'löschen',
				layout: 'list',
				title: 'Unwiderruflich — das Original bleibt erhalten',
				items: [
					{ text: 'stromabrechnung-2024.pdf', note: 'Original' },
					{ text: 'scan-0417.pdf', note: 'identisch', struck: true },
					{ text: 'scan-0418.pdf', note: 'identisch', struck: true },
					{ text: 'IMG_2291.pdf', note: 'Foto derselben Seite', struck: true }
				]
			}
		}
	},
	{
		id: 'kita',
		type: 'frist',
		title: 'Kita-Anmeldung bis 01.09.',
		source: 'E-Mail · Stadt',
		when: 'gestern · 16:30',
		deadline: 'bis 01.09.',
		status: 'waiting',
		log: [
			{
				step: 'E-Mail eingegangen',
				when: 'gestern · 16:30',
				state: 'done',
				skill: 'inbox',
				note: 'Einladung zum Anmeldegespräch · Frist 01.09.'
			},
			{
				step: 'Terminkonflikt',
				when: 'gestern · 16:31',
				state: 'waiting',
				skill: 'calendar',
				note: 'der Vorschlag kollidiert mit einem bestehenden Termin'
			}
		],
		artifacts: [
			{ kind: 'calendar', title: 'Anmeldegespräch Kita', note: '28.08. · 10:00–11:00' },
			{ kind: 'doc', title: 'kita-einladung.pdf', note: 'archiviert' }
		],
		skills: [
			{
				skill: 'calendar',
				state: 'waiting',
				note: 'Konflikt am 28.08. — Entscheidung offen',
				workflow: 'frist',
				done: ['date-trigger'],
				current: 'schedule'
			}
		],
		hitl: {
			label: 'Termin trotz Konflikt eintragen?',
			method: 'calendar_conflict',
			actor: 'calendar',
			preview: {
				kind: 'konflikt',
				layout: 'compare',
				title: 'Donnerstag, 28.08. — zwei Termine zur selben Zeit',
				sides: [
					{
						heading: 'Neu',
						lines: ['Anmeldegespräch Kita', '10:00 – 11:00', 'Stadt · Kita Sonnenblume']
					},
					{ heading: 'Bestehend', lines: ['Team-Review', '10:30 – 11:30', 'überschneidet 30 Min'] }
				]
			}
		}
	},
	{
		id: 'kontoauszug',
		type: 'abgleich',
		title: 'Kontoauszug Juli abgleichen',
		source: 'Upload · CSV',
		when: 'gestern · 18:40',
		status: 'archive',
		log: [
			{
				step: 'Kontoauszug hochgeladen',
				when: 'gestern · 18:40',
				state: 'done',
				skill: 'inbox',
				note: 'kontoauszug-07.csv · 38 Transaktionen'
			},
			{
				step: 'Abgeglichen',
				when: 'gestern · 18:41',
				state: 'done',
				skill: 'abgleich',
				card: {
					title: '6 Zahlungen zugeordnet, 1 nachgefragt',
					text: '31 bekannte Daueraufträge übersprungen. 6 offene Rechnungen automatisch abgehakt; „Miete August" wurde von dir bestätigt.'
				}
			},
			{
				step: 'Todos abgehakt',
				when: 'gestern · 18:41',
				state: 'done',
				skill: 'todos',
				note: '6 Rechnungs-Todos → erledigt'
			}
		],
		artifacts: [
			{ kind: 'statement', title: 'kontoauszug-07.csv', note: '38 Transaktionen' },
			{ kind: 'todo', title: 'Miete August überweisen', note: 'erledigt · abgeglichen' }
		],
		skills: [
			{
				skill: 'abgleich',
				state: 'done',
				note: '38 Transaktionen · 7 zugeordnet',
				workflow: 'match',
				done: ['statement-trigger', 'match', 'tick']
			},
			{
				skill: 'todos',
				state: 'done',
				note: '6 Todos abgehakt',
				workflow: 'capture',
				done: ['voice-trigger', 'create', 'list-view', 'board-view']
			}
		],
		hitl: {
			label: 'Zahlung der Rechnung zuordnen',
			method: 'match_confirm',
			actor: 'abgleich',
			preview: {
				kind: 'abgleich',
				layout: 'compare',
				title: 'Score 91 % — knapp unter der Auto-Schwelle',
				sides: [
					{
						heading: 'Buchung',
						lines: ['28.07. · −1.150,00 €', 'Hausverwaltung Berg', 'Dauerauftrag']
					},
					{ heading: 'Offener Posten', lines: ['Miete 08/2025', '1.150,00 €', 'fällig 03.08.'] }
				]
			}
		}
	},
	{
		id: 'handyvertrag',
		type: 'frist',
		title: 'Handyvertrag rechtzeitig gekündigt',
		source: 'Post-Scan · Brief',
		when: 'heute · 07:20',
		status: 'done',
		log: [
			{
				step: 'Kündigungsfrist erkannt',
				when: '05.08. · 09:10',
				state: 'done',
				skill: 'inbox',
				note: 'Vertrag läuft am 31.08. aus · Frist 4 Wochen'
			},
			{
				step: 'Kündigung freigegeben und versendet',
				when: 'heute · 07:20',
				state: 'done',
				skill: 'docs',
				note: 'Bestätigung liegt im Archiv'
			}
		],
		artifacts: [
			{ kind: 'doc', title: 'kuendigung-handyvertrag.pdf', note: 'versendet 07:20 · archiviert' },
			{ kind: 'person', title: 'Telekom Deutschland', note: 'Firma · Mobilfunk' }
		],
		skills: [
			{
				skill: 'docs',
				state: 'done',
				note: 'Kündigung versendet',
				workflow: 'respond',
				done: ['request-trigger', 'draft', 'approve', 'finish']
			},
			{
				skill: 'inbox',
				state: 'done',
				note: 'Frist erkannt · Intent extrahiert',
				workflow: 'intake',
				done: ['mail-trigger', 'upload-trigger', 'normalize', 'classify', 'route']
			}
		],
		hitl: {
			label: 'Kündigungsbestätigung ablegen',
			method: 'archive_confirm',
			actor: 'docs',
			preview: {
				kind: 'ablage',
				layout: 'document',
				title: 'Ablage in [[Verträge]] / Mobilfunk',
				body: 'Telekom Deutschland bestätigt die Kündigung zum 31.08.2025. Vertragsnummer 4412-88231. Eine weitere Rechnung folgt für den letzten Abrechnungszeitraum.',
				attachments: ['bestaetigung-telekom.pdf']
			}
		}
	},
	{
		id: 'fitnessstudio',
		type: 'auftrag',
		title: '„Kündige das Fitnessstudio"',
		source: 'Freitext · Chat',
		when: 'gestern · 21:15',
		status: 'error',
		log: [
			{
				step: 'Auftrag erfasst',
				when: 'gestern · 21:15',
				state: 'done',
				skill: 'inbox',
				note: 'freier Auftrag aus dem Chat'
			},
			{
				step: 'Intent extrahiert',
				when: 'gestern · 21:15',
				state: 'done',
				skill: 'inbox',
				note: 'Kündigung: Vertrag finden, Frist prüfen, Schreiben aufsetzen'
			},
			{
				step: 'Vertrag nicht gefunden',
				when: 'seit gestern',
				state: 'waiting',
				skill: 'docs',
				note: 'kein FitX-Vertrag im Archiv — lade ihn hoch oder sag mir, wo er liegt'
			}
		],
		artifacts: [{ kind: 'entity', title: '[[FitX Vertrag]]', note: 'Brain · gesucht…' }],
		skills: [
			{
				skill: 'docs',
				state: 'waiting',
				note: 'Archiv-Suche ohne Treffer',
				workflow: 'respond',
				done: ['request-trigger'],
				current: 'draft'
			},
			{
				skill: 'brain',
				state: 'waiting',
				note: 'wartet auf den Vertrag',
				workflow: 'verknuepfen',
				done: [],
				current: 'entity-trigger'
			}
		],
		hitl: {
			label: 'Vertrag manuell nachreichen',
			method: 'upload_request',
			actor: 'docs',
			preview: {
				kind: 'fehlt',
				layout: 'choice',
				title: 'Kein FitX-Vertrag im Archiv — 428 Dokumente durchsucht',
				options: [
					{ label: 'Vertrag jetzt hochladen', note: 'empfohlen', chosen: true },
					{ label: 'Ohne Vertrag kündigen', note: 'Frist unbekannt' },
					{ label: 'Ich sage dir, wo er liegt', note: 'Freitext' }
				]
			}
		}
	}
]

let selectedId = $state(INTENTS[0].id)
const selected = $derived(INTENTS.find((i) => i.id === selectedId) ?? INTENTS[0])

/**
 * Talk to MAIA — the REAL chat: the transcript comes from the chat actor,
 * the input from the global voice/text pill, and the answers may be
 * INLINE VIEWS — every window actor the model (or a click) opens renders
 * right here in the conversation. The Views tab is gone; this is where
 * views live now.
 */
const chat = chatActor.core

/** Done intents rest in the archive — a toggle, closed by default. */
let archiveOpen = $state(false)
/** What needs you first: broken, then blocked, then moving, then settled. */
const STATE_ORDER: Record<IntentState, number> = {
	error: 0,
	waiting: 1,
	working: 2,
	done: 3,
	archive: 4
}
const activeIntents = $derived(
	INTENTS.filter((i) => i.status !== 'archive').sort(
		(a, b) => STATE_ORDER[a.status] - STATE_ORDER[b.status]
	)
)
const archivedIntents = $derived(INTENTS.filter((i) => i.status === 'archive'))

/**
 * The center shows ONE of three things: the activity log (default), an
 * artifact preview, or a skill's flow stepper. Selecting an intent — or
 * the back button — returns to the log.
 */
let preview = $state<MockArtifact | null>(null)
let skillView = $state<SkillStatus | null>(null)

/**
 * Every intent's gate goes into the REAL queue, tagged with its intent —
 * the bar above the pill shows only the one whose intent is on screen.
 */
// The queue is an HMR-surviving singleton: drop gates from earlier mock
// generations, or a stale one without its preview shadows the real thing.
const mockIds = new Set(INTENTS.filter((i) => i.hitl).map((i) => `mock-${i.id}`))
hitlQueue.items = hitlQueue.items.filter((h) => !h.id.startsWith('mock-') || mockIds.has(h.id))

for (const intent of INTENTS) {
	if (!intent.hitl) continue
	const id = `mock-${intent.id}`
	if (hitlQueue.items.some((h) => h.id === id)) continue
	hitlQueue.items.push({
		id,
		actor: intent.hitl.actor,
		method: intent.hitl.method,
		label: intent.hitl.label,
		detail: intent.hitl.preview.title,
		context: intent.id,
		preview: intent.hitl.preview
	})
}

/**
 * The selected skill instance rendered ON its template workflow — the
 * same layout + node cards as the Skills viewer, the instance state
 * (done/current) overlaid per node.
 */
let sfNodes = $state.raw<Node[]>([])
let sfEdges = $state.raw<Edge[]>([])
$effect.pre(() => {
	const view = skillView
	if (!view) {
		sfNodes = []
		sfEdges = []
		return
	}
	const template = skillById(view.skill)
	const wf = template?.workflows.find((w) => w.id === view.workflow) ?? template?.workflows[0]
	if (!wf) {
		sfNodes = []
		sfEdges = []
		return
	}
	const laid = layoutWorkflow(wf)
	sfNodes = laid.nodes.map((n) => ({
		id: n.id,
		type: 'flow',
		position: n.position,
		draggable: false,
		data: {
			node: n.node,
			selected: false,
			instance: view.done.includes(n.id)
				? ('done' as const)
				: n.id === view.current
					? view.state === 'waiting'
						? ('waiting' as const)
						: ('running' as const)
					: undefined
		}
	}))
	sfEdges = laid.edges.map((e, i) => ({
		id: `${e.from}-${e.predicate}-${e.to}-${i}`,
		source: e.from,
		target: e.to,
		label: e.predicate,
		type: 'smoothstep',
		style: 'stroke: rgba(47,93,80,0.5); stroke-width: 1.5;',
		labelStyle: 'font-size: 10px; fill: rgba(30,41,59,0.7);',
		labelBgStyle: 'fill: var(--color-linen);',
		labelBgPadding: [4, 2] as [number, number],
		labelBgBorderRadius: 4
	}))
})
const sfNodeTypes = { flow: FlowNode }
let sfW = $state(0)
let sfH = $state(0)

/**
 * The center column follows its content: like a chat, the newest thing —
 * a fresh log entry, a streamed reply, an opened inline view — is always
 * in sight at the bottom.
 */
// HITL gates scope to what is on screen: the selected intent, or the talk.
$effect(() => {
	talk.intentContext = talk.open ? null : selectedId
})

let centerEl: HTMLElement | null = $state(null)
let transcriptEl: HTMLElement | null = $state(null)
$effect(() => {
	void chat.turns.length
	void chat.turns.at(-1)?.content
	void selected.log.length
	void talk.open
	void registryTick.v
	const el = talk.open ? transcriptEl : centerEl
	el?.scrollTo({ top: el.scrollHeight })
})

/** The workspace scale — 85%: compact enough to see the whole stream,
 * large enough to read it comfortably. */
const WS_ZOOM = 0.85

const DOT: Record<string, string> = {
	done: 'bg-state-done text-status-success-foreground',
	running: 'bg-state-working text-primary-foreground',
	waiting: 'bg-state-waiting text-status-info-foreground'
}
</script>

{#snippet backButton()}
	<button
		type="button"
		onclick={() => {
			preview = null
			skillView = null
		}}
		class="ml-auto shrink-0 rounded-full border border-foreground/10 px-3 py-1 text-foreground/60 text-xs transition-colors hover:bg-surface-card"
	>
		← Zurück zum Verlauf
	</button>
{/snippet}

<!-- The workspace runs at 85% scale: more of the stream, the log and the
     views fit on one screen. `zoom` scales the layout itself (not just the
     paint), so every measurement below stays honest — only the dock
     clearance is divided back out, since it is measured OUTSIDE this box. -->
<div class="flex min-h-0 w-full flex-1 gap-3 overflow-hidden" style="zoom: {WS_ZOOM}">
	{#if talk.open}
		<!-- TALK CONTEXT (global, from the spark rail): the conversation is a
		     25% aside on the left; the right 75% is the VIEW surface — every
		     window the model opens renders there full width. -->
		<aside
			bind:this={transcriptEl}
			class="flex w-1/4 min-w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-foreground/5 bg-surface-raised p-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
		>
			{#if chat.turns.length === 0}
				<p class="pt-6 text-center text-foreground/40 text-sm">
					Sprich oder tippe unten — Fragen, Aufträge, oder „zeig mir die Todos".
				</p>
			{/if}
			{#each chat.turns as turn (turn.id)}
				<div class="flex" class:justify-end={turn.role === 'user'}>
					<div
						class="max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed {turn.role ===
						'user'
							? 'bg-primary text-primary-foreground'
							: 'border border-border bg-surface-card'}"
					>
						{#if turn.content === '' && turn.role === 'assistant' && chat.streaming}
							<span class="flex items-center gap-1 py-1" aria-label="Thinking">
								<span class="size-1.5 animate-bounce rounded-full bg-current opacity-40"></span>
								<span
									class="size-1.5 animate-bounce rounded-full bg-current opacity-40 [animation-delay:150ms]"
								></span>
								<span
									class="size-1.5 animate-bounce rounded-full bg-current opacity-40 [animation-delay:300ms]"
								></span>
							</span>
						{:else}
							{turn.content}
						{/if}
					</div>
				</div>
			{/each}
		</aside>

		<main
			class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-2xl border border-foreground/5 bg-surface-raised shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			style="margin-bottom: calc(var(--dock-h, 0px) / {WS_ZOOM})"
		>
			{#if registryTick.v >= 0}
				{@const openWindows = bus
					.actors()
					.filter(isWindow)
					.filter((w) => w.open && w.subject.manifest.id !== 'chat')}
				{#if openWindows.length === 0}
					<div class="flex h-full flex-col items-center justify-center gap-3 text-center">
						<span class="block size-12 overflow-hidden rounded-full border border-border">
							<img src="/aven-logo.svg" alt="" class="size-full object-cover">
						</span>
						<p class="text-foreground/40 text-sm">
							„Zeig mir die Todos" — die Ansicht erscheint hier.
						</p>
					</div>
				{:else}
					{#each openWindows as w (w.manifest.id)}
						{@const Face = w.component as import('svelte').Component<{ actor: typeof w.subject }>}
						<button
							type="button"
							onclick={() => {
								w.open = false
								registryTick.v++
							}}
							title="Ansicht schließen"
							aria-label="Ansicht schließen"
							class="absolute top-2 right-3 z-10 text-foreground/30 transition-colors hover:text-foreground"
						>
							×
						</button>
						<Face actor={w.subject} {...w.props} />
					{/each}
				{/if}
			{/if}
		</main>
	{:else}
		<!-- LEFT: the intent stream — compact cards, cream selection. -->
		<aside class="flex min-h-0 w-72 shrink-0 flex-col gap-2 overflow-y-auto pb-2">
			<h2
				class="px-1 pt-1 text-center font-semibold text-foreground/50 text-xs uppercase tracking-wide"
			>
				Intents · {activeIntents.length}
			</h2>
			{#each activeIntents as intent (intent.id)}
				{@const sel = selectedId === intent.id && !talk.open}
				{@const accent = STATE_ACCENT[intent.status]}
				<!-- Hover shifts the FILL, never the border: `hover:border-*` paints all
				     four sides and, sitting in a later cascade layer, greyed out the 3px
				     state edge — the one thing the card exists to show. -->
				<button
					type="button"
					onclick={() => {
						selectedId = intent.id
						preview = null
						skillView = null
						talk.open = false
					}}
					class="rounded-xl border border-l-[3px] px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {accent.edge} {sel
						? 'border-foreground/15 bg-surface-card-selected'
						: 'border-foreground/5 bg-surface-raised hover:bg-surface-card-hover'}"
				>
					<!-- row 1: what it is — title, with its type on the right -->
					<div class="flex items-baseline gap-2">
						<p class="min-w-0 flex-1 font-medium text-xs leading-snug">{intent.title}</p>
						<span
							class="shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.5625rem] {TYPE_BADGE}"
						>
							{intent.type}
						</span>
					</div>
					<!-- row 2: where it came from, when, and where it stands -->
					<div class="flex items-center gap-2 pt-1">
						<span class="truncate text-[0.6875rem] text-foreground/45">{intent.source}</span>
						<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/35">
							{intent.when}
						</span>
						{#if intent.deadline}
							<span
								class="shrink-0 rounded-full bg-status-error/10 px-1.5 py-0.5 font-mono text-status-error-ink text-[0.5625rem]"
							>
								{intent.deadline}
							</span>
						{/if}
					</div>
				</button>
			{/each}

			<!-- The archive: done intents rest here, folded away by default. -->
			<button
				type="button"
				onclick={() => {
				archiveOpen = !archiveOpen
			}}
				class="flex items-center gap-1.5 px-1 pt-3 text-left font-semibold text-foreground/50 text-xs uppercase tracking-wide transition-colors hover:text-foreground/80"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-3 transition-transform {archiveOpen ? 'rotate-90' : ''}"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="m9 6 6 6-6 6" />
				</svg>
				Archiv · {archivedIntents.length}
			</button>
			{#if archiveOpen}
				{#each archivedIntents as intent (intent.id)}
					{@const sel = selectedId === intent.id && !talk.open}
					<button
						type="button"
						onclick={() => {
							selectedId = intent.id
							preview = null
							skillView = null
							talk.open = false
						}}
						class="rounded-xl border border-l-[3px] border-l-state-archive px-4 py-3 text-left opacity-70 shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all hover:opacity-100 {sel
							? 'border-foreground/15 bg-surface-card-selected opacity-100'
							: 'border-foreground/5 bg-surface-raised hover:border-foreground/15'}"
					>
						<div class="flex items-baseline gap-2">
							<p class="min-w-0 flex-1 font-medium text-xs leading-snug">{intent.title}</p>
							<span
								class="shrink-0 rounded-full px-2 py-0.5 font-mono text-[0.5625rem] {TYPE_BADGE}"
							>
								{intent.type}
							</span>
						</div>
						<div class="flex items-center gap-2 pt-1">
							<span class="truncate text-[0.6875rem] text-foreground/45">{intent.source}</span>
						</div>
					</button>
				{/each}
			{/if}
		</aside>

		<!-- CENTER: activity log / artifact preview / skill stepper. -->
		<!-- The center column wears the intent's STATE as its header — the same
		     uppercase line as INTENTS and SKILLS beside it, so all three
		     columns start their cards on one line. -->
		<div
			class="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
			style="margin-bottom: calc(var(--dock-h, 0px) / {WS_ZOOM})"
		>
			<h2
				class="px-1 pt-1 text-center font-semibold text-xs uppercase tracking-wide {STATE_ACCENT[
					selected.status
				].text}"
			>
				{STATUS_LABEL[selected.status]}
			</h2>
			<main
				bind:this={centerEl}
				class="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl border border-foreground/5 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
			>
				{#if skillView}
					<!-- SKILL FLOW STEPPER: where this skill stands for this intent. -->
					{@const skillLog = selected.log.filter((e) => e.skill === skillView?.skill)}
					<header class="flex items-center gap-3">
						<span
							class="size-2 shrink-0 rounded-full {skillView.state === 'done'
						? 'bg-state-done'
						: skillView.state === 'waiting'
							? 'bg-state-waiting'
							: 'bg-state-working'}"
						></span>
						<div class="min-w-0">
							<h1 class="font-mono font-semibold text-lg leading-tight">{skillView.skill}</h1>
							<p class="text-foreground/45 text-xs">{skillView.note}</p>
						</div>
						{@render backButton()}
					</header>
					<div class="border-border border-b"></div>

					<!-- the ACTUAL template workflow (same cards as the Skills viewer),
			     the instance state overlaid: ✓ done, amber running, red waiting -->
					<div
						bind:clientWidth={sfW}
						bind:clientHeight={sfH}
						class="h-[340px] w-full shrink-0 overflow-hidden rounded-xl border border-border bg-surface-soft/60"
					>
						{#key skillView.skill}
							{#if sfNodes.length === 0}
								<p class="flex h-full items-center justify-center text-foreground/40 text-sm">
									{skillView.skill}
									— Template folgt; die Instanz läuft als Teil der Inbox-Pipeline.
								</p>
							{:else}
								<SvelteFlow
									nodes={sfNodes}
									edges={sfEdges}
									nodeTypes={sfNodeTypes}
									fitView
									minZoom={0.15}
									proOptions={{ hideAttribution: true }}
								>
									<Background bgColor="transparent" patternColor="rgba(30,41,59,0.08)" />
									<FitView w={sfW} h={sfH} />
								</SvelteFlow>
							{/if}
						{/key}
					</div>

					<!-- what this skill logged into the intent's stream -->
					{#if skillLog.length > 0}
						<h2 class="pt-4 font-semibold text-foreground/50 text-xs uppercase tracking-wide">
							Log dieses Skills
						</h2>
						<ul class="flex flex-col gap-2">
							{#each skillLog as entry (entry.step)}
								<li class="flex items-baseline gap-3 text-sm">
									<span class="font-mono text-[0.625rem] text-foreground/35">{entry.when}</span>
									<span class="min-w-0 flex-1">{entry.step}</span>
									<span
										class="font-mono text-[0.625rem] {entry.state === 'done'
									? 'text-state-done-ink'
									: entry.state === 'waiting'
										? 'text-state-error-ink'
										: 'text-state-working-ink'}"
									>
										{entry.state === 'done' ? '✓' : entry.state === 'waiting' ? '⏸' : '⟳'}
									</span>
								</li>
							{/each}
						</ul>
					{/if}
				{:else if preview}
					<!-- ARTIFACT PREVIEW: full width — header, a divider, the view. -->
					<header class="flex items-center gap-2">
						<span
							class="flex h-8 w-10 items-center justify-center rounded-lg bg-surface-soft font-mono text-[0.5625rem] text-foreground/50"
						>
							{KIND_LABEL[preview.kind]}
						</span>
						<div class="min-w-0">
							<h1 class="truncate font-semibold text-lg leading-tight">{preview.title}</h1>
							<p class="text-foreground/45 text-xs">{preview.note}</p>
						</div>
						{@render backButton()}
					</header>
					<div class="border-border border-b"></div>

					{#if preview.kind === 'doc'}
						<div class="w-full pt-2">
							<div class="flex items-baseline justify-between pb-6">
								<span class="font-semibold text-sm">{preview.title.replace('.pdf', '')}</span>
								<span class="font-mono text-[0.625rem] text-foreground/40">Seite 1 / 2</span>
							</div>
							{#each [92, 100, 78, 96, 60] as w, i (i)}
								<div class="mb-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
							{/each}
							<div class="mt-5 rounded-lg border border-status-warning/35 bg-status-warning/12 px-4 py-3">
								<p class="font-mono text-status-warning-ink text-[0.625rem] uppercase tracking-wide">
									Extrahiert
								</p>
								<p class="pt-1 text-xs leading-relaxed">{preview.note}</p>
							</div>
							{#each [88, 95, 70] as w, i (i)}
								<div class="mt-2 h-2 rounded bg-foreground/8" style="width: {w}%"></div>
							{/each}
						</div>
					{:else if preview.kind === 'todo'}
						<div class="w-full pt-2">
							<div class="flex items-center gap-3">
								<span
									class="flex size-5 items-center justify-center rounded-md border-2 border-foreground/20"
								></span>
								<span class="flex-1 font-medium text-sm">{preview.title}</span>
								<span class="rounded-full bg-surface-soft px-2 py-0.5 font-mono text-[0.625rem]">
									todos
								</span>
							</div>
							<p class="pt-2 pl-8 text-foreground/50 text-xs">{preview.note}</p>
						</div>
					{:else if preview.kind === 'calendar'}
						<div class="flex w-full items-center gap-4 pt-2">
							<div
								class="flex size-14 flex-col items-center justify-center rounded-xl bg-status-error/10 text-status-error-ink"
							>
								<span class="font-semibold text-lg leading-none">15</span>
								<span class="pt-0.5 font-mono text-[0.5625rem] uppercase">Sep</span>
							</div>
							<div class="min-w-0">
								<p class="font-medium text-sm">{preview.title}</p>
								<p class="pt-0.5 text-foreground/50 text-xs">{preview.note}</p>
							</div>
						</div>
					{:else if preview.kind === 'person'}
						<div class="w-full pt-2">
							<div class="flex items-center gap-4">
								<span
									class="flex size-12 items-center justify-center rounded-full bg-primary/12 font-semibold text-primary text-sm"
								>
									{preview.title.slice(0, 2).toUpperCase()}
								</span>
								<div class="min-w-0">
									<p class="font-semibold text-sm">{preview.title}</p>
									<p class="text-foreground/50 text-xs">{preview.note}</p>
								</div>
							</div>
							<div class="mt-4 grid grid-cols-2 gap-2 text-xs">
								<div class="rounded-lg bg-surface-soft px-3 py-2">
									<span class="text-foreground/40">Bezug</span><br>3 Intents · 2 Dokumente
								</div>
								<div class="rounded-lg bg-surface-soft px-3 py-2">
									<span class="text-foreground/40">Zuletzt</span><br>heute · Brief eingegangen
								</div>
							</div>
						</div>
					{:else if preview.kind === 'statement'}
						<div class="w-full pt-2">
							{#each [{ d: '28.07.', t: 'Miete August', a: '−1.150,00 €', m: 'abgeglichen ✓' }, { d: '25.07.', t: 'Möbelhaus Nord GmbH', a: '−249,00 €', m: 'Rechnung zugeordnet ✓' }, { d: '24.07.', t: 'Gehalt', a: '+3.480,00 €', m: '' }] as row (row.d + row.t)}
								<div class="flex items-center gap-3 border-border/60 border-b py-2.5 text-sm">
									<span class="w-14 font-mono text-foreground/40 text-xs">{row.d}</span>
									<span class="min-w-0 flex-1 truncate">{row.t}</span>
									<span class="font-mono {row.a.startsWith('+') ? 'text-state-done-ink' : ''}"
										>{row.a}</span
									>
									<span class="w-40 text-right text-[0.6875rem] text-foreground/40">{row.m}</span>
								</div>
							{/each}
						</div>
					{:else}
						<!-- brain entity: an Obsidian-style markdown note with wikilinks -->
						<div class="w-full max-w-2xl pt-2 font-mono text-[13px] leading-relaxed">
							<p class="text-foreground/35">---</p>
							<p class="text-foreground/55">
								tags: <span class="text-status-warning-ink">#versicherung #frist</span>
							</p>
							<p class="text-foreground/55">erstellt: 2025-08-12 · quelle: inbox</p>
							<p class="pb-3 text-foreground/35">---</p>
							<h1 class="pb-2 font-sans font-semibold text-xl">
								{preview.title.replaceAll('[', '').replaceAll(']', '')}
							</h1>
							<p class="pb-3 text-foreground/75">
								Sammelt alles rund um Versicherungen in 2025. Der Brief der
								<span
									class="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2"
									>[[Techniker Krankenkasse]]</span
								>
								verlangt einen
								<span
									class="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2"
									>[[Einkommensnachweis]]</span
								>
								bis zur Frist am 15.09. — das Todo hängt an
								<span
									class="cursor-pointer text-primary underline decoration-primary/30 underline-offset-2"
									>[[Fristen 2025]]</span
								>.
							</p>
							<p class="pb-1 text-foreground/75">## Offen</p>
							<p class="pb-0.5 text-foreground/75">
								- [ ] Nachweis einreichen <span class="text-foreground/40">(fällig 12.09.)</span>
							</p>
							<p class="pb-3 text-foreground/75">
								- [x] <span class="line-through opacity-60">Brief archivieren</span>
							</p>
							<p class="pb-1 text-foreground/75">## Verknüpft</p>
							<div class="flex flex-wrap gap-1.5 pb-4">
								{#each ['[[Techniker Krankenkasse]]', '[[Einkommensnachweis]]', '[[Fristen 2025]]', '[[Steuer 2023]]'] as link (link)}
									<span
										class="cursor-pointer rounded-md bg-primary/10 px-2 py-0.5 text-primary text-xs"
										>{link}</span
									>
								{/each}
							</div>
							<div class="border-border border-t pt-3">
								<p
									class="pb-1 font-sans font-semibold text-foreground/50 text-xs uppercase tracking-wide"
								>
									Backlinks · 3
								</p>
								<p class="text-foreground/55 text-xs">
									[[Krankenkasse: Nachweis bis 15.09.]] · [[Steuer 2023]] · [[Post-Eingang August]]
								</p>
							</div>
						</div>
					{/if}
				{:else}
					<!-- ACTIVITY LOG: the intent's journey, every entry typed by skill. -->
					<header>
						<div class="flex items-center gap-2">
							<span
								class="rounded-full px-2 py-0.5 font-mono text-[0.625rem] {TYPE_BADGE}"
							>
								{selected.type}
							</span>
							{#if selected.deadline}
								<span
									class="rounded-full bg-status-error/10 px-2 py-0.5 font-mono text-status-error-ink text-[0.625rem]"
								>
									{selected.deadline}
								</span>
							{/if}
						</div>
						<h1 class="pt-2 font-semibold text-xl leading-tight">{selected.title}</h1>
						<p class="pt-1 text-foreground/45 text-xs">{selected.source} · {selected.when}</p>
					</header>

					<ol class="flex flex-col">
						{#each selected.log as entry, i (entry.step + i)}
							<li class="relative flex gap-3 pb-5">
								{#if i < selected.log.length - 1}
									<span class="absolute top-6 bottom-0 left-[11px] w-px bg-foreground/10"></span>
								{/if}
								<span
									class="z-10 mt-0.5 flex size-[23px] shrink-0 items-center justify-center rounded-full {DOT[
								entry.state
							]}"
								>
									{#if entry.state === 'done'}
										<svg
											viewBox="0 0 24 24"
											class="size-3"
											fill="none"
											stroke="currentColor"
											stroke-width="3"
											stroke-linecap="round"
											stroke-linejoin="round"
										>
											<path d="m5 13 4 4L19 7" />
										</svg>
									{:else if entry.state === 'running'}
										<svg
											viewBox="0 0 24 24"
											class="size-3"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
										>
											<path d="M21 12a9 9 0 1 1-6.2-8.56" />
										</svg>
									{:else}
										<svg
											viewBox="0 0 24 24"
											class="size-3"
											fill="none"
											stroke="currentColor"
											stroke-width="2.5"
											stroke-linecap="round"
										>
											<circle cx="12" cy="12" r="9" />
											<path d="M12 7v5l3 3" />
										</svg>
									{/if}
								</span>
								<div class="min-w-0 flex-1">
									<div class="flex items-baseline gap-2">
										<span class="font-medium text-sm">{entry.step}</span>
										<!-- the entry is TYPED: which skill wrote it -->
										<button
											type="button"
											onclick={() => {
										skillView = selected.skills.find((s) => s.skill === entry.skill) ?? null
										preview = null
									}}
											class="rounded-md bg-surface-soft px-1.5 py-0.5 font-mono text-[0.5625rem] text-foreground/55 transition-colors hover:bg-surface-card-selected"
										>
											{entry.skill}
										</button>
										<span class="ml-auto shrink-0 font-mono text-[0.625rem] text-foreground/35">
											{entry.when}
										</span>
									</div>
									{#if entry.note}
										<p class="pt-0.5 text-foreground/50 text-xs leading-relaxed">{entry.note}</p>
									{/if}
									{#if entry.card}
										<div class="mt-2 rounded-xl border border-border bg-surface-card px-4 py-3">
											<p class="font-medium text-xs">{entry.card.title}</p>
											<p class="pt-1 text-foreground/55 text-xs leading-relaxed">
												{entry.card.text}
											</p>
											{#if entry.hitl}
												<p class="pt-2 font-mono text-status-error-ink text-[0.625rem]">
													→ wartet in der globalen Freigabe-Leiste über der Voice-Pill
												</p>
											{/if}
										</div>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
				{/if}
			</main>
		</div>

		<!-- RIGHT: SKILLS (click → stepper) above ARTIFACTS (click → preview). -->
		{#if !talk.open}
			<aside class="flex min-h-0 w-72 shrink-0 flex-col gap-2 overflow-y-auto pb-2">
				<h2
					class="px-1 pt-1 text-center font-semibold text-foreground/50 text-xs uppercase tracking-wide"
				>
					Skills · {selected.skills.length}
				</h2>
				{#each selected.skills as s (s.skill)}
					<button
						type="button"
						onclick={() => {
					skillView = skillView?.skill === s.skill ? null : s
					preview = null
				}}
						class="rounded-xl border px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {skillView?.skill ===
				s.skill
					? 'border-foreground/15 bg-surface-card-selected'
					: 'border-foreground/5 bg-surface-raised hover:border-foreground/15'}"
					>
						<div class="flex items-center gap-2">
							<span
								class="size-1.5 shrink-0 rounded-full {s.state === 'done'
							? 'bg-state-done'
							: s.state === 'waiting'
								? 'bg-state-waiting'
								: 'bg-state-working'}"
							></span>
							<span class="font-medium font-mono text-xs">{s.skill}</span>
							<span class="ml-auto font-mono text-[0.625rem] text-foreground/40">
								{s.state === 'done' ? 'fertig' : s.state === 'waiting' ? 'wartet' : 'läuft'}
							</span>
						</div>
						<p class="pt-1 text-[0.6875rem] text-foreground/50 leading-relaxed">{s.note}</p>
					</button>
				{/each}

				{#if !talk.open}
					<h2
						class="px-1 pt-3 text-center font-semibold text-foreground/50 text-xs uppercase tracking-wide"
					>
						Artefakte · {selected.artifacts.length}
					</h2>
					{#each selected.artifacts as artifact (artifact.title)}
						<button
							type="button"
							onclick={() => {
						preview = preview?.title === artifact.title ? null : artifact
						skillView = null
					}}
							class="rounded-xl border px-4 py-3 text-left shadow-[0_1px_3px_rgba(30,41,59,0.05)] transition-all {preview?.title ===
					artifact.title
						? 'border-foreground/15 bg-surface-card-selected'
						: 'border-foreground/5 bg-surface-raised hover:border-foreground/15'}"
						>
							<div class="flex items-center gap-2">
								<span
									class="flex h-8 w-10 items-center justify-center rounded-lg bg-surface-soft font-mono text-[0.5625rem] text-foreground/50"
								>
									{KIND_LABEL[artifact.kind]}
								</span>
								<div class="min-w-0">
									<p class="truncate font-medium text-xs">{artifact.title}</p>
									<p class="truncate text-[0.6875rem] text-foreground/45">{artifact.note}</p>
								</div>
							</div>
						</button>
					{/each}
				{/if}

				<p class="px-1 pt-2 text-[0.625rem] text-foreground/35 leading-relaxed">
					Ein Intent kombiniert Artefakte und Skill-Flows, um eine Aufgabe zu lösen. Alles hier ist
					ein Mock — die Pipeline (ingest → classify → intents → skill-flows) kommt später.
				</p>
			</aside>
		{/if}
	{/if}
</div>
