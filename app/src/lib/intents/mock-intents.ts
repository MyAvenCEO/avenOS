/**
 * Intent-Cockpit — die Mock-Daten des UX-Brainstormings.
 *
 * Das Denkmodell: ALLES, was hereinkommt, ist ein Ereignis, das geroutet
 * wird — ein Upload, ein Kontoumsatz, eine Notiz, auch jede HITL-Antwort.
 * Geroutet wird immer auf einen INTENT: entweder entsteht ein neuer, oder
 * das Ereignis heftet sich an einen bestehenden, der davon weiterläuft.
 *
 * Ein Intent ist die menschliche Arbeitseinheit: ein Ziel in einem Satz.
 * Für dieses Ziel arbeiten n Skill-Läufe — parallel, wo nichts dazwischen
 * liegt, in Abhängigkeit, wo einer das Ergebnis des anderen braucht. Die
 * Abhängigkeit gehört dem RAHMEN (jede Karte kann sie zeigen), das
 * Fachliche gehört dem GESICHT des Skills. Deshalb ist der Status eines
 * Intents ABGELEITET, nie gepflegt: er ist die Summe seiner Läufe.
 *
 * Alles hier ist hartkodiert — es geht um die Form der Arbeit, nicht um
 * die Maschine dahinter.
 */

export type RunZustand = 'laeuft' | 'wartet-mensch' | 'wartet-ergebnis' | 'fertig'
export type IntentStatus = 'braucht-dich' | 'laeuft' | 'fertig'

/** Die Stufen des geteilten Steppers — jede Karte trägt dieselbe Form. */
export interface Schritt {
	name: string
	zustand: 'done' | 'current' | 'blocked' | 'pending'
}

/** Die Gesichter, die es gibt — der Rahmen kennt nur diesen Schlüssel. */
export const FACE_KEYS = ['archiv', 'match', 'buchung', 'triage'] as const
export type FaceKey = (typeof FACE_KEYS)[number]

export interface SkillRun {
	id: string
	skill: string
	/** Was dieser Skill FÜR DIESEN Intent tut — ein Satz, kein Typ. */
	zweck: string
	zustand: RunZustand
	/** Wovon dieser Lauf abhängt: ein Lauf desselben Intents + das Stück. */
	braucht?: { run: string; was: string }
	schritte: Schritt[]
	face: FaceKey
	/** Frei geformt — nur das jeweilige Gesicht versteht seine Daten. */
	daten: Record<string, unknown>
}

export interface Intent {
	id: string
	titel: string
	/** Das Ziel als Satz — die Einheit, in der ein Mensch delegiert. */
	ziel: string
	/** Woher der Intent kam: das Ereignis, das ihn erzeugt hat. */
	quelle: string
	erfasst: string
	runs: SkillRun[]
}

/** Ein noch ungeroutetes Ereignis — der Beweis, dass alles eins ist. */
export interface Eingang {
	id: string
	text: string
	um: string
	vorschlag?: { intent: string; grund: string }
}

/** Der Status ist die Summe der Läufe — niemand pflegt ihn von Hand. */
export function intentStatus(intent: Intent): IntentStatus {
	if (intent.runs.some((r) => r.zustand === 'wartet-mensch')) return 'braucht-dich'
	if (intent.runs.every((r) => r.zustand === 'fertig')) return 'fertig'
	return 'laeuft'
}

export const eingaenge: Eingang[] = [
	{
		id: 'e-1',
		text: 'Kontoumsatz · −450,00 € · „MUELLER GMBH RE081 DANKE" · 12.08.',
		um: 'vor 2 min',
		vorschlag: {
			intent: 'i-081',
			grund: 'Matchmaken dieses Intents sucht genau diese Zahlung.'
		}
	}
]

export const intents: Intent[] = [
	{
		id: 'i-081',
		titel: 'Rechnung Müller GmbH · RE-081',
		ziel: 'Die Rechnung ablegen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus Upload „scan-2026-08-14-0007.pdf"',
		erfasst: '14.08. 10:03',
		runs: [
			{
				id: 'r-081-archiv',
				skill: 'Archivieren',
				zweck: 'Beleg unveränderlich ablegen (GoBD)',
				zustand: 'fertig',
				schritte: [
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Prüfen', zustand: 'done' },
					{ name: 'Ablegen', zustand: 'done' }
				],
				face: 'archiv',
				daten: {
					datei: 'scan-2026-08-14-0007.pdf',
					beleg: 'RE-2026-081',
					ablage: 'Belege / 2026 / August',
					um: '14.08. 10:04'
				}
			},
			{
				id: 'r-081-match',
				skill: 'Matchmaken',
				zweck: 'Die Zahlung zur Rechnung finden',
				zustand: 'wartet-mensch',
				braucht: { run: 'r-081-archiv', was: 'Beleg' },
				schritte: [
					{ name: 'Zahlungen suchen', zustand: 'done' },
					{ name: 'Bewerten', zustand: 'done' },
					{ name: 'Bestätigen', zustand: 'current' }
				],
				face: 'match',
				daten: {
					kandidaten: [
						{
							id: 'k1',
							datum: '12.08.',
							betrag: '−450,00 €',
							text: 'MUELLER GMBH RE081 DANKE',
							score: 0.92
						},
						{ id: 'k2', datum: '14.08.', betrag: '−450,00 €', text: 'MUELLER GMBH', score: 0.61 }
					]
				}
			},
			{
				id: 'r-081-buchung',
				skill: 'Verbuchen',
				zweck: 'Buchungszeilen bilden und festschreiben',
				zustand: 'wartet-ergebnis',
				braucht: { run: 'r-081-match', was: 'bestätigter Treffer' },
				// Zeilen bilden lief PARALLEL zum Matchmaken — nur der Abgleich
				// braucht den Treffer. Genau das zeigt die Karte.
				schritte: [
					{ name: 'Zeilen bilden', zustand: 'done' },
					{ name: 'Abgleich', zustand: 'blocked' },
					{ name: 'Festschreiben', zustand: 'pending' }
				],
				face: 'buchung',
				daten: {
					zeilen: [
						{ konto: '6815', bez: 'Bürobedarf', soll: '378,15', haben: '' },
						{ konto: '1406', bez: 'Vorsteuer 19 %', soll: '71,85', haben: '' },
						{ konto: '3300', bez: 'Verbindlichkeiten aLuL', soll: '', haben: '450,00' }
					]
				}
			}
		]
	},
	{
		id: 'i-077',
		titel: 'Rechnung Steinmann · RE-077',
		ziel: 'Die Rechnung ablegen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus E-Mail-Anhang „RE-077.pdf"',
		erfasst: '11.08. 09:12',
		runs: [
			{
				id: 'r-077-archiv',
				skill: 'Archivieren',
				zweck: 'Beleg unveränderlich ablegen (GoBD)',
				zustand: 'fertig',
				schritte: [
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Prüfen', zustand: 'done' },
					{ name: 'Ablegen', zustand: 'done' }
				],
				face: 'archiv',
				daten: {
					datei: 'RE-077.pdf',
					beleg: 'RE-2026-077',
					ablage: 'Belege / 2026 / August',
					um: '11.08. 09:13'
				}
			},
			{
				id: 'r-077-match',
				skill: 'Matchmaken',
				zweck: 'Die Zahlung zur Rechnung finden',
				zustand: 'fertig',
				braucht: { run: 'r-077-archiv', was: 'Beleg' },
				schritte: [
					{ name: 'Zahlungen suchen', zustand: 'done' },
					{ name: 'Bewerten', zustand: 'done' },
					{ name: 'Bestätigen', zustand: 'done' }
				],
				face: 'match',
				daten: {
					gewaehlt: '14.08. · −1.190,00 € · „STEINMANN RE 077"',
					score: 0.97,
					freigabe: 'auto ab 95 % · freigegeben von samuel'
				}
			},
			{
				id: 'r-077-buchung',
				skill: 'Verbuchen',
				zweck: 'Buchungszeilen bilden und festschreiben',
				zustand: 'wartet-mensch',
				braucht: { run: 'r-077-match', was: 'bestätigter Treffer' },
				schritte: [
					{ name: 'Zeilen bilden', zustand: 'done' },
					{ name: 'Abgleich', zustand: 'done' },
					{ name: 'Festschreiben', zustand: 'current' }
				],
				face: 'buchung',
				daten: {
					zeilen: [
						{ konto: '6600', bez: 'Werbekosten', soll: '1.000,00', haben: '' },
						{ konto: '1406', bez: 'Vorsteuer 19 %', soll: '190,00', haben: '' },
						{ konto: '3300', bez: 'Verbindlichkeiten aLuL', soll: '', haben: '1.190,00' }
					],
					festschreibbar: true
				}
			}
		]
	},
	{
		id: 'i-note',
		titel: 'Notiz vom Spaziergang',
		ziel: 'Den Gedanken einordnen — oder bewusst verwerfen.',
		quelle: 'aus Sprachnotiz',
		erfasst: '14.08. 10:41',
		runs: [
			{
				id: 'r-note-triage',
				skill: 'Einordnen',
				zweck: 'Die Notiz einer Klasse zuordnen',
				zustand: 'wartet-mensch',
				schritte: [
					{ name: 'Klassifizieren', zustand: 'done' },
					{ name: 'Einordnen', zustand: 'current' }
				],
				face: 'triage',
				daten: {
					notiz: 'irgendwas mit Sichtbarkeit und Vertrauen — später nochmal denken',
					befund: 'kein klares Urteil — bester Wert 41 % unter der Schwelle',
					aktionen: ['als-idee', 'als-todo', 'verwerfen']
				}
			}
		]
	},
	{
		id: 'i-090',
		titel: 'Rechnung Bergmann · RE-090',
		ziel: 'Die Rechnung ablegen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus Upload „scan-2026-08-20-0002.pdf"',
		erfasst: 'gerade eben',
		runs: [
			{
				id: 'r-090-archiv',
				skill: 'Archivieren',
				zweck: 'Beleg unveränderlich ablegen (GoBD)',
				zustand: 'laeuft',
				schritte: [
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Prüfen', zustand: 'current' },
					{ name: 'Ablegen', zustand: 'pending' }
				],
				face: 'archiv',
				daten: { datei: 'scan-2026-08-20-0002.pdf' }
			},
			{
				id: 'r-090-match',
				skill: 'Matchmaken',
				zweck: 'Die Zahlung zur Rechnung finden',
				zustand: 'wartet-ergebnis',
				braucht: { run: 'r-090-archiv', was: 'Beleg' },
				schritte: [
					{ name: 'Zahlungen suchen', zustand: 'blocked' },
					{ name: 'Bewerten', zustand: 'pending' },
					{ name: 'Bestätigen', zustand: 'pending' }
				],
				face: 'match',
				daten: { kandidaten: [] }
			},
			{
				id: 'r-090-buchung',
				skill: 'Verbuchen',
				zweck: 'Buchungszeilen bilden und festschreiben',
				zustand: 'wartet-ergebnis',
				braucht: { run: 'r-090-match', was: 'bestätigter Treffer' },
				schritte: [
					{ name: 'Zeilen bilden', zustand: 'blocked' },
					{ name: 'Abgleich', zustand: 'pending' },
					{ name: 'Festschreiben', zustand: 'pending' }
				],
				face: 'buchung',
				daten: { zeilen: [] }
			}
		]
	},
	{
		id: 'i-069',
		titel: 'Rechnung Weber · RE-069',
		ziel: 'Die Rechnung ablegen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus Upload',
		erfasst: '05.08.',
		runs: [
			{
				id: 'r-069-archiv',
				skill: 'Archivieren',
				zweck: 'Beleg unveränderlich ablegen (GoBD)',
				zustand: 'fertig',
				schritte: [
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Prüfen', zustand: 'done' },
					{ name: 'Ablegen', zustand: 'done' }
				],
				face: 'archiv',
				daten: {
					datei: 'weber-re069.pdf',
					beleg: 'RE-2026-069',
					ablage: 'Belege / 2026 / August',
					um: '05.08. 08:12'
				}
			},
			{
				id: 'r-069-match',
				skill: 'Matchmaken',
				zweck: 'Die Zahlung zur Rechnung finden',
				zustand: 'fertig',
				braucht: { run: 'r-069-archiv', was: 'Beleg' },
				schritte: [
					{ name: 'Zahlungen suchen', zustand: 'done' },
					{ name: 'Bewerten', zustand: 'done' },
					{ name: 'Bestätigen', zustand: 'done' }
				],
				face: 'match',
				daten: {
					gewaehlt: '06.08. · −890,00 € · „WEBER GMBH RE069"',
					score: 0.99,
					freigabe: 'auto ab 95 % · freigegeben von samuel'
				}
			},
			{
				id: 'r-069-buchung',
				skill: 'Verbuchen',
				zweck: 'Buchungszeilen bilden und festschreiben',
				zustand: 'fertig',
				braucht: { run: 'r-069-match', was: 'bestätigter Treffer' },
				schritte: [
					{ name: 'Zeilen bilden', zustand: 'done' },
					{ name: 'Abgleich', zustand: 'done' },
					{ name: 'Festschreiben', zustand: 'done' }
				],
				face: 'buchung',
				daten: {
					zeilen: [
						{ konto: '6805', bez: 'Telefon', soll: '747,90', haben: '' },
						{ konto: '1406', bez: 'Vorsteuer 19 %', soll: '142,10', haben: '' },
						{ konto: '3300', bez: 'Verbindlichkeiten aLuL', soll: '', haben: '890,00' }
					],
					festgeschrieben: 'Journal J-2026-0803 · 13.08.2026'
				}
			}
		]
	}
]
