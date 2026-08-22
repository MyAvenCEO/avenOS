import { Actor } from '$lib/actors/actor'
import { bus, type HeldPreview } from '$lib/actors/bus'
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { singleton } from '$lib/actors/singleton'

/**
 * THE INTENTS — the workspace's subjects, MOCKED (0158) but owned by an
 * actor, so the model manages them the way it manages windows: by message.
 * The column renders `items` and `selectedId`; the tools below switch,
 * create, merge and delete, and the UI follows.
 */

export interface LogEntry {
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
export interface MockArtifact {
	kind: 'doc' | 'todo' | 'calendar' | 'person' | 'entity' | 'statement'
	title: string
	note: string
}
export interface SkillStatus {
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
export interface MockIntent {
	id: string
	type: string
	title: string
	source: string
	when: string
	deadline?: string
	status: IntentState
	/** The state it had before it was archived, so restoring brings it back as it was. */
	before?: IntentState
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

export type IntentState = 'working' | 'waiting' | 'done' | 'error' | 'archive'

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

let nextId = 1
const slug = (title: string) =>
	`${title
		.toLowerCase()
		.replace(/[^a-z0-9äöüß]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 24)}-${nextId++}`

const now = () => {
	const d = new Date()
	return `heute · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

class IntentsActor extends Actor {
	items = $state<MockIntent[]>(INTENTS)
	selectedId = $state(INTENTS[0].id)

	constructor() {
		super({
			id: 'intents',
			name: 'Intents',
			description:
				'The intents: every task the workspace is working on, one stream each. ' +
				'Lists, switches, creates, edits, merges, archives, restores and deletes them by message.',
			tags: ['intents'],
			methods: [
				{
					name: 'intent_list',
					description: 'Lists all intents with id, title, type and status.',
					parameters: { type: 'object', properties: {} }
				},
				{
					name: 'intent_switch',
					description:
						'Switches to an intent — puts its stream on screen and scopes the conversation ' +
						'to it. Use whenever the user asks to open, go to, or work on another intent. ' +
						'Accepts the id or a part of the title.',
					parameters: {
						type: 'object',
						properties: { intent: { type: 'string', description: 'id, or part of the title' } },
						required: ['intent']
					}
				},
				{
					name: 'intent_create',
					description:
						'Creates a new intent and switches to it. Use when the user starts something new ' +
						'that is not part of the current intent.',
					parameters: {
						type: 'object',
						properties: {
							title: { type: 'string', description: 'short imperative title' },
							type: { type: 'string', description: 'one word: auftrag, frist, abgleich, …' },
							source: { type: 'string', description: 'where it came from, e.g. "Freitext · Chat"' },
							deadline: { type: 'string', description: 'e.g. "bis 30.09." — optional' }
						},
						required: ['title']
					}
				},
				{
					name: 'intent_update',
					description:
						"Edits an intent's metadata: title, type, source, deadline, status. Only the " +
						'given fields change. Use for renaming, re-dating, re-typing, or setting the ' +
						'state (working, waiting, done, error).',
					parameters: {
						type: 'object',
						properties: {
							intent: { type: 'string', description: 'id, or part of the title' },
							title: { type: 'string' },
							type: { type: 'string', description: 'one word: auftrag, frist, abgleich, …' },
							source: { type: 'string' },
							deadline: {
								type: 'string',
								description: 'e.g. "bis 30.09."; empty string removes it'
							},
							status: {
								type: 'string',
								enum: ['working', 'waiting', 'done', 'error'],
								description: 'use intent_archive to archive'
							}
						},
						required: ['intent']
					}
				},
				{
					name: 'intent_merge',
					description:
						"Merges intents into one: the others' activity logs, conversations, artifacts and " +
						'skills move into the target and the others are deleted. Confirm with the user first.',
					parameters: {
						type: 'object',
						properties: {
							into: { type: 'string', description: 'the intent that survives — id or title part' },
							from: {
								type: 'array',
								items: { type: 'string' },
								description: 'the intents folded in — ids or title parts'
							}
						},
						required: ['into', 'from']
					}
				},
				{
					name: 'intent_archive',
					description:
						'Archives an intent: it leaves the active list and rests under ARCHIV, ' +
						'nothing is lost. Use when the user says it is done, finished, or to put it away.',
					parameters: {
						type: 'object',
						properties: { intent: { type: 'string', description: 'id, or part of the title' } },
						required: ['intent']
					}
				},
				{
					name: 'intent_restore',
					description: 'Brings an archived intent back to the active list and switches to it.',
					parameters: {
						type: 'object',
						properties: { intent: { type: 'string', description: 'id, or part of the title' } },
						required: ['intent']
					}
				},
				{
					name: 'intent_delete',
					description:
						'Deletes an intent for good. Confirm with the user first. The last intent cannot be deleted.',
					parameters: {
						type: 'object',
						properties: { intent: { type: 'string', description: 'id, or part of the title' } },
						required: ['intent']
					}
				}
			]
		})
		this.bind({
			intent_list: () => {
				const rows = this.items.map((i) => ({
					id: i.id,
					title: i.title,
					type: i.type,
					status: i.status
				}))
				return {
					record: JSON.stringify({ ok: true, intents: rows, selected: this.selectedId }),
					wire: rows.map((r) => `${r.id}: "${r.title}" (${r.type}, ${r.status})`).join('\n')
				}
			},
			intent_switch: (p) => {
				const hit = this.find(String(p.intent ?? ''))
				if (!hit) return this.miss(String(p.intent ?? ''))
				this.goTo(hit.id)
				return {
					record: JSON.stringify({ ok: true, selected: hit.id }),
					wire: `"${hit.title}" is on screen now.`
				}
			},
			intent_create: (p) => {
				const title = String(p.title ?? '').trim()
				if (title === '')
					return { record: '{"ok":false,"error":"title missing"}', wire: 'A title is needed.' }
				const intent: MockIntent = {
					id: slug(title),
					type: String(p.type ?? 'auftrag'),
					title,
					source: String(p.source ?? 'Freitext · Chat'),
					when: now(),
					...(p.deadline ? { deadline: String(p.deadline) } : {}),
					status: 'working',
					log: [
						{
							step: 'Auftrag erfasst',
							when: now(),
							state: 'done',
							skill: 'email-manager',
							note: 'im Gespräch angelegt'
						}
					],
					artifacts: [],
					skills: []
				}
				this.items.unshift(intent)
				this.goTo(intent.id)
				return {
					record: JSON.stringify({ ok: true, created: intent.id }),
					wire: `Created "${title}" and switched to it.`
				}
			},
			intent_update: (p) => {
				const hit = this.find(String(p.intent ?? ''))
				if (!hit) return this.miss(String(p.intent ?? ''))
				const changed: string[] = []
				if (typeof p.title === 'string' && p.title.trim() !== '') {
					hit.title = p.title.trim()
					changed.push('title')
				}
				if (typeof p.type === 'string' && p.type.trim() !== '') {
					hit.type = p.type.trim()
					changed.push('type')
				}
				if (typeof p.source === 'string' && p.source.trim() !== '') {
					hit.source = p.source.trim()
					changed.push('source')
				}
				if (typeof p.deadline === 'string') {
					if (p.deadline.trim() === '') delete hit.deadline
					else hit.deadline = p.deadline.trim()
					changed.push('deadline')
				}
				if (
					typeof p.status === 'string' &&
					['working', 'waiting', 'done', 'error'].includes(p.status)
				) {
					hit.status = p.status as IntentState
					changed.push('status')
				}
				if (changed.length === 0)
					return { record: '{"ok":false,"error":"nothing to change"}', wire: 'Nothing to change.' }
				return {
					record: JSON.stringify({ ok: true, updated: hit.id, changed }),
					wire: `Updated ${changed.join(', ')} of "${hit.title}".`
				}
			},
			intent_merge: (p) => {
				const target = this.find(String(p.into ?? ''))
				if (!target) return this.miss(String(p.into ?? ''))
				const froms = (Array.isArray(p.from) ? p.from : [p.from])
					.map((f) => this.find(String(f ?? '')))
					.filter((f): f is MockIntent => !!f && f.id !== target.id)
				if (froms.length === 0)
					return { record: '{"ok":false,"error":"nothing to merge"}', wire: 'Nothing to merge.' }
				chatActor.core.mergeSessions(
					froms.map((f) => f.id),
					target.id
				)
				for (const f of froms) {
					target.log.push(...f.log)
					target.artifacts.push(...f.artifacts)
					for (const sk of f.skills)
						if (!target.skills.some((t) => t.skill === sk.skill)) target.skills.push(sk)
					this.items = this.items.filter((i) => i.id !== f.id)
				}
				this.goTo(target.id)
				return {
					record: JSON.stringify({ ok: true, into: target.id, merged: froms.map((f) => f.id) }),
					wire: `Merged ${froms.map((f) => `"${f.title}"`).join(', ')} into "${target.title}".`
				}
			},
			intent_archive: (p) => {
				const hit = this.find(String(p.intent ?? ''))
				if (!hit) return this.miss(String(p.intent ?? ''))
				if (hit.status === 'archive')
					return {
						record: '{"ok":true,"already":true}',
						wire: `"${hit.title}" is already archived.`
					}
				hit.before = hit.status
				hit.status = 'archive'
				// The stream moves on to the next active intent, if there is one.
				const next = this.items.find((i) => i.status !== 'archive')
				if (this.selectedId === hit.id && next) this.selectedId = next.id
				return {
					record: JSON.stringify({ ok: true, archived: hit.id }),
					wire: `Archived "${hit.title}".`
				}
			},
			intent_restore: (p) => {
				const hit = this.find(String(p.intent ?? ''))
				if (!hit) return this.miss(String(p.intent ?? ''))
				if (hit.status === 'archive') hit.status = hit.before ?? 'done'
				this.goTo(hit.id)
				return {
					record: JSON.stringify({ ok: true, restored: hit.id }),
					wire: `"${hit.title}" is back on the list and on screen.`
				}
			},
			intent_delete: (p) => {
				const hit = this.find(String(p.intent ?? ''))
				if (!hit) return this.miss(String(p.intent ?? ''))
				if (this.items.length === 1)
					return { record: '{"ok":false,"error":"last intent"}', wire: 'The last intent stays.' }
				this.items = this.items.filter((i) => i.id !== hit.id)
				if (this.selectedId === hit.id) this.selectedId = this.items[0].id
				return {
					record: JSON.stringify({ ok: true, deleted: hit.id }),
					wire: `Deleted "${hit.title}".`
				}
			}
		})
	}

	/**
	 * Put an intent on screen AND carry the conversation there: the question
	 * that asked for it and the answer it gets belong to that intent's stream.
	 */
	goTo(id: string): void {
		this.selectedId = id
		chatActor.core.relocateTurn(id)
	}

	/** By id, else by a case-insensitive part of the title. */
	find(key: string): MockIntent | undefined {
		const k = key.trim().toLowerCase()
		if (k === '') return undefined
		return (
			this.items.find((i) => i.id === k) ??
			this.items.find((i) => i.title.toLowerCase().includes(k))
		)
	}

	miss(key: string) {
		return {
			record: JSON.stringify({ ok: false, error: `no intent matches "${key}"` }),
			wire: `No intent matches "${key}". Ask intent_list for what exists.`
		}
	}

	override instanceState(): Record<string, unknown> {
		return { count: this.items.length, selected: this.selectedId }
	}
}

export const intents = singleton('aven.intents', () => new IntentsActor())
bus.register(intents)
