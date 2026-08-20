/**
 * Intent-Cockpit — die Mock-Daten, jetzt auf den ECHTEN Konfigurationen.
 *
 * Das Denkmodell: ALLES, was hereinkommt, ist ein Ereignis, das geroutet
 * wird — ein Upload, ein Kontoumsatz, eine Notiz, auch jede HITL-Antwort.
 * Geroutet wird immer auf einen INTENT: entweder entsteht ein neuer, oder
 * das Ereignis heftet sich an einen bestehenden, der davon weiterläuft.
 *
 * Neu gegenüber dem ersten Wurf: die Läufe hängen an den KONFIGURIERTEN
 * Skills und Flows (skill-config / recipe-config) statt an erfundenen —
 * und sie tragen die rekursive Komposition, die dort längst deklariert
 * ist. Ein Schritt eines Laufs kann selbst ein ganzer Lauf sein
 * (`unter`, verbunden über `alsSchritt`): inbox-triage ruft
 * belege-extrahieren, das wiederum scan-zu-dokument ruft — drei Ebenen,
 * dieselbe Kartenform auf jeder. Skill-GRENZEN (handoff) bleiben dagegen
 * Geschwister-Läufe mit `braucht`: der Inbox-Skill weiß nicht, was die
 * Buchhaltung tut, er kennt nur den Vertrag.
 *
 * Ein komponierter Lauf hat oft KEIN eigenes Gesicht — sein Inhalt SIND
 * seine Kinder. Deshalb ist `face` optional: Blätter zeigen Fachliches,
 * Kompositionen zeigen Struktur.
 */

export type RunZustand = 'laeuft' | 'wartet-mensch' | 'wartet-ergebnis' | 'fertig'
export type IntentStatus = 'braucht-dich' | 'laeuft' | 'fertig'

/** Die Stufen des geteilten Steppers — jede Karte trägt dieselbe Form. */
export interface Schritt {
	name: string
	zustand: 'done' | 'current' | 'blocked' | 'pending'
}

export interface SkillRun {
	id: string
	/** Anzeigename; bei Top-Level-Läufen der Skill, bei Kindern der Flow. */
	skill: string
	/** Nur Top-Level: die Skill-Id aus der skill-config-Registry. */
	skillId?: string
	/** Der Flow aus der flachen Rezept-Registry, den dieser Lauf ausführt. */
	flow: string
	/** Was dieser Lauf FÜR DIESEN Intent tut — ein Satz, kein Typ. */
	zweck: string
	zustand: RunZustand
	/**
	 * Wovon dieser Lauf abhängt — zwei Reichweiten, ein Mechanismus:
	 * `run` = ein Geschwister-Lauf im selben Intent (Skill-Grenze);
	 * `intents` = GANZE andere Intents (der Monatsabschluss wartet auf
	 * alle Beleg-Intents des Monats — ein Beleg ist ein Intent, der
	 * Monat auch, und der eine speist den anderen).
	 */
	braucht?: { run?: string; intents?: string[]; was: string }
	/** Schrittnamen = Knotennamen des Flows (der gegangene Pfad). */
	schritte: Schritt[]
	/** Frei geformt — nur die Signatur des Skills versteht ihre Daten. */
	daten?: Record<string, unknown>
	/** Welcher Schritt des ELTERN-Laufs dieser Lauf ist (nur bei Kindern). */
	alsSchritt?: string
	/** Rekursion: Schritte, die selbst ganze Läufe sind. */
	unter?: SkillRun[]
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

/**
 * Die SPUR eines Laufs: die Rekursion, plattgedrückt auf das, was ein
 * Mensch braucht. Oben die eigenen Schritte als Punkte; darunter — egal
 * wie tief die Komposition ist — EINE Pfadzeile vom aktuellen Schritt
 * bis zum Blatt, an dem wirklich gearbeitet wird. Tiefe ist ein Pfad,
 * keine Schachtel.
 */
export function spur(run: SkillRun): { pfad: string[]; erledigt: number } {
	const pfad: string[] = []
	let aktuell: SkillRun | undefined = run
	while (aktuell) {
		const dran: Schritt | undefined = aktuell.schritte.find((s) => s.zustand === 'current')
		if (!dran) break
		pfad.push(dran.name)
		aktuell = aktuell.unter?.find((u) => u.alsSchritt === dran.name)
	}
	return { pfad, erledigt: run.schritte.filter((s) => s.zustand === 'done').length }
}

/** Sucht einen Daten-Schlüssel im Baum — das Blatt weiß es, die Karte fragt. */
export function fund<T>(run: SkillRun, schluessel: string): T | undefined {
	if (run.daten && schluessel in run.daten) return run.daten[schluessel] as T
	for (const u of run.unter ?? []) {
		const w = fund<T>(u, schluessel)
		if (w !== undefined) return w
	}
	return undefined
}

/** Alle Läufe eines Intents, rekursiv — für Bilanz und Verträge. */
export function alleLaeufe(intent: Intent): SkillRun[] {
	const raus: SkillRun[] = []
	const geh = (runs: SkillRun[]) => {
		for (const r of runs) {
			raus.push(r)
			if (r.unter) geh(r.unter)
		}
	}
	geh(intent.runs)
	return raus
}

export const eingaenge: Eingang[] = [
	{
		id: 'e-1',
		text: 'Kontoumsatz · −450,00 € · „MUELLER GMBH RE081 DANKE" · 12.08.',
		um: 'vor 2 min',
		vorschlag: {
			intent: 'i-mueller',
			grund: 'Der Zahlungsabgleich dieses Intents sucht genau diese Zahlung.'
		}
	}
]

export const intents: Intent[] = [
	{
		id: 'i-mueller',
		titel: 'Rechnung Müller GmbH · RE-081',
		ziel: 'Den Scan lesen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus Upload „scan-2026-08-14-0007.pdf"',
		erfasst: '14.08. 10:03',
		runs: [
			{
				id: 'r-mueller-inbox',
				skill: 'Inbox',
				skillId: 'inbox',
				flow: 'inbox-triage',
				zweck: 'Aus dem Scan lesbare Positionen machen',
				zustand: 'fertig',
				daten: { fakt: 'RE-2026-081 · 3 Positionen gelesen · Konfidenz 91 %' },
				schritte: [
					{ name: 'Upload', zustand: 'done' },
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Vorgänge trennen', zustand: 'done' },
					{ name: 'Klassifizieren', zustand: 'done' },
					{ name: 'Triage', zustand: 'done' },
					{ name: 'Belege extrahieren', zustand: 'done' },
					{ name: '→ Buchhaltung', zustand: 'done' }
				],
				unter: [
					{
						id: 'r-mueller-extract',
						skill: 'Belege extrahieren',
						flow: 'belege-extrahieren',
						zweck: 'Scan | PDF | E-Rechnung → Positionen mit Konfidenz',
						zustand: 'fertig',
						alsSchritt: 'Belege extrahieren',
						schritte: [
							{ name: 'Dokument', zustand: 'done' },
							{ name: 'Belegweiche', zustand: 'done' },
							{ name: 'Scan lesen', zustand: 'done' },
							{ name: 'Positionen', zustand: 'done' }
						],
						unter: [
							{
								id: 'r-mueller-ocr',
								skill: 'Scan → Dokument',
								flow: 'scan-zu-dokument',
								zweck: 'Vision-OCR mit Dokumenttyp „rechnung"',
								zustand: 'fertig',
								alsSchritt: 'Scan lesen',
								schritte: [
									{ name: 'Bild', zustand: 'done' },
									{ name: 'Vorverarbeiten', zustand: 'done' },
									{ name: 'Schema wählen', zustand: 'done' },
									{ name: 'Vision-OCR', zustand: 'done' },
									{ name: 'Strukturierte Daten', zustand: 'done' }
								]
							}
						]
					}
				]
			},
			{
				id: 'r-mueller-buchhaltung',
				skill: 'Buchhaltung',
				skillId: 'buchhaltung',
				flow: 'eingangsrechnung-buchen',
				zweck: 'Aus Positionen Buchungen machen — bis zur Festschreibung',
				zustand: 'wartet-mensch',
				braucht: { run: 'r-mueller-inbox', was: 'Positionen (Übergabe)' },
				schritte: [
					{ name: 'Positionen', zustand: 'done' },
					{ name: 'Kontenplan & Policy', zustand: 'done' },
					{ name: 'Zahlungsabgleich', zustand: 'done' },
					{ name: 'Buchungsvorgang', zustand: 'current' },
					{ name: 'Buchungsstapel', zustand: 'pending' }
				],
				unter: [
					{
						id: 'r-mueller-abgleich',
						skill: 'Zahlungsabgleich',
						flow: 'zahlungsabgleich',
						zweck: 'Die Zahlung zur Rechnung finden',
						zustand: 'fertig',
						alsSchritt: 'Zahlungsabgleich',
						schritte: [
							{ name: 'Transaktionen', zustand: 'done' },
							{ name: 'Zahlung matchen', zustand: 'done' },
							{ name: 'Abgeglichene Zahlungen', zustand: 'done' }
						],
						daten: {
							gewaehlt: '12.08. · −450,00 € · „MUELLER GMBH RE081 DANKE"',
							score: 0.92,
							freigabe: 'von dir bestätigt · 14.08. 12:40 — die Antwort wurde Ereignis'
						}
					},
					{
						id: 'r-mueller-buchung',
						skill: 'Buchungsvorgang',
						flow: 'buchungsvorgang',
						zweck: 'Kontieren, Steuerlogik, Vier-Augen, Festschreiben',
						zustand: 'wartet-mensch',
						alsSchritt: 'Buchungsvorgang',
						schritte: [
							{ name: 'Leistungsart klassifizieren', zustand: 'done' },
							{ name: 'Steuerlogik', zustand: 'done' },
							{ name: 'Buchungszeilen ableiten', zustand: 'done' },
							{ name: 'Validieren', zustand: 'done' },
							{ name: 'Freigabe Buchhalter', zustand: 'current' },
							{ name: 'Festschreiben', zustand: 'pending' }
						],
						daten: {
							zeilen: [
								{ konto: '6815', bez: 'Bürobedarf', soll: '378,15', haben: '' },
								{ konto: '1406', bez: 'Vorsteuer 19 %', soll: '71,85', haben: '' },
								{ konto: '3300', bez: 'Verbindlichkeiten aLuL', soll: '', haben: '450,00' }
							],
							summe: '450,00',
							festschreibbar: true
						}
					}
				]
			}
		]
	},
	{
		id: 'i-liefer',
		titel: 'Scan vom 12.08. — Lieferschein?',
		ziel: 'Herausfinden, was das ist — und es dorthin geben, wo es hingehört.',
		quelle: 'aus Upload „scan-2026-08-12-0003.pdf"',
		erfasst: '12.08. 08:44',
		runs: [
			{
				id: 'r-liefer-inbox',
				skill: 'Inbox',
				skillId: 'inbox',
				flow: 'inbox-triage',
				zweck: 'Den Scan einer Klasse zuordnen',
				zustand: 'fertig',
				daten: { fakt: 'keine Klasse über der Schwelle — an HITL übergeben' },
				schritte: [
					{ name: 'Upload', zustand: 'done' },
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Vorgänge trennen', zustand: 'done' },
					{ name: 'Klassifizieren', zustand: 'done' },
					{ name: 'Triage', zustand: 'done' },
					{ name: '→ HITL (Weiß-nicht-Box)', zustand: 'done' }
				]
			},
			{
				id: 'r-liefer-hitl',
				skill: 'HITL',
				skillId: 'hitl',
				flow: 'hitl-posteingang',
				zweck: 'Ein Mensch entscheidet, was keine Klasse fand',
				zustand: 'wartet-mensch',
				braucht: { run: 'r-liefer-inbox', was: 'Übergabe „unklar"' },
				schritte: [
					{ name: 'Unklares', zustand: 'done' },
					{ name: 'Nach Risiko sortieren', zustand: 'done' },
					{ name: 'Entscheiden', zustand: 'current' }
				],
				daten: {
					notiz: 'scan-2026-08-12-0003.pdf — vermutlich ein Lieferschein',
					befund: 'kein Belegtyp über der Schwelle — weder Rechnung noch Kontoauszug',
					aktionen: ['als-beleg', 'als-auszug', 'verwerfen']
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
				id: 'r-note-intents',
				skill: 'Intents',
				skillId: 'intents',
				flow: 'intents-triage',
				zweck: 'Die Notiz einer Klasse zuordnen',
				zustand: 'wartet-mensch',
				schritte: [
					{ name: 'Notizen', zustand: 'done' },
					{ name: 'Einordnen', zustand: 'done' },
					{ name: 'Intent-Weiche', zustand: 'done' },
					{ name: 'Unklares einordnen', zustand: 'current' }
				],
				daten: {
					notiz: 'irgendwas mit Sichtbarkeit und Vertrauen — später nochmal denken',
					befund: 'kein klares Urteil — bester Wert 41 % unter der Schwelle',
					klassen: [
						{ label: 'idee', wert: 0.41 },
						{ label: 'todo', wert: 0.31 },
						{ label: 'unbekannt', wert: 0.28 }
					],
					aktionen: ['als-idee', 'als-todo', 'verwerfen']
				}
			}
		]
	},
	{
		id: 'i-bergmann',
		titel: 'Rechnung Bergmann · RE-090',
		ziel: 'Den Scan lesen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus Upload „scan-2026-08-20-0002.pdf"',
		erfasst: 'gerade eben',
		runs: [
			{
				id: 'r-bergmann-inbox',
				skill: 'Inbox',
				skillId: 'inbox',
				flow: 'inbox-triage',
				zweck: 'Aus dem Scan lesbare Positionen machen',
				zustand: 'laeuft',
				daten: { fakt: 'liest den Scan — Schema „rechnung" gewählt' },
				schritte: [
					{ name: 'Upload', zustand: 'done' },
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Vorgänge trennen', zustand: 'done' },
					{ name: 'Klassifizieren', zustand: 'done' },
					{ name: 'Triage', zustand: 'done' },
					{ name: 'Belege extrahieren', zustand: 'current' },
					{ name: '→ Buchhaltung', zustand: 'pending' }
				],
				unter: [
					{
						id: 'r-bergmann-extract',
						skill: 'Belege extrahieren',
						flow: 'belege-extrahieren',
						zweck: 'Scan | PDF | E-Rechnung → Positionen mit Konfidenz',
						zustand: 'laeuft',
						alsSchritt: 'Belege extrahieren',
						schritte: [
							{ name: 'Dokument', zustand: 'done' },
							{ name: 'Belegweiche', zustand: 'done' },
							{ name: 'Scan lesen', zustand: 'current' },
							{ name: 'Positionen', zustand: 'pending' }
						],
						unter: [
							{
								id: 'r-bergmann-ocr',
								skill: 'Scan → Dokument',
								flow: 'scan-zu-dokument',
								zweck: 'Vision-OCR mit Dokumenttyp „rechnung"',
								zustand: 'laeuft',
								alsSchritt: 'Scan lesen',
								schritte: [
									{ name: 'Bild', zustand: 'done' },
									{ name: 'Vorverarbeiten', zustand: 'done' },
									{ name: 'Schema wählen', zustand: 'done' },
									{ name: 'Vision-OCR', zustand: 'current' },
									{ name: 'Strukturierte Daten', zustand: 'pending' }
								]
							}
						]
					}
				]
			},
			{
				id: 'r-bergmann-buchhaltung',
				skill: 'Buchhaltung',
				skillId: 'buchhaltung',
				flow: 'eingangsrechnung-buchen',
				zweck: 'Aus Positionen Buchungen machen — bis zur Festschreibung',
				zustand: 'wartet-ergebnis',
				braucht: { run: 'r-bergmann-inbox', was: 'Positionen (Übergabe)' },
				schritte: [
					{ name: 'Positionen', zustand: 'blocked' },
					{ name: 'Zahlungsabgleich', zustand: 'pending' },
					{ name: 'Buchungsvorgang', zustand: 'pending' },
					{ name: 'Buchungsstapel', zustand: 'pending' }
				]
			}
		]
	},
	{
		id: 'i-weber',
		titel: 'Rechnung Weber · RE-069',
		ziel: 'Den Scan lesen, der Zahlung zuordnen und festschreiben.',
		quelle: 'aus Upload',
		erfasst: '05.08.',
		runs: [
			{
				id: 'r-weber-inbox',
				skill: 'Inbox',
				skillId: 'inbox',
				flow: 'inbox-triage',
				zweck: 'Aus dem Scan lesbare Positionen machen',
				zustand: 'fertig',
				daten: { fakt: 'RE-2026-069 · 2 Positionen gelesen · Konfidenz 95 %' },
				schritte: [
					{ name: 'Upload', zustand: 'done' },
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Klassifizieren', zustand: 'done' },
					{ name: 'Triage', zustand: 'done' },
					{ name: 'Belege extrahieren', zustand: 'done' },
					{ name: '→ Buchhaltung', zustand: 'done' }
				]
			},
			{
				id: 'r-weber-buchhaltung',
				skill: 'Buchhaltung',
				skillId: 'buchhaltung',
				flow: 'eingangsrechnung-buchen',
				zweck: 'Aus Positionen Buchungen machen — bis zur Festschreibung',
				zustand: 'fertig',
				braucht: { run: 'r-weber-inbox', was: 'Positionen (Übergabe)' },
				schritte: [
					{ name: 'Positionen', zustand: 'done' },
					{ name: 'Zahlungsabgleich', zustand: 'done' },
					{ name: 'Buchungsvorgang', zustand: 'done' },
					{ name: 'Buchungsstapel', zustand: 'done' }
				],
				unter: [
					{
						id: 'r-weber-buchung',
						skill: 'Buchungsvorgang',
						flow: 'buchungsvorgang',
						zweck: 'Kontieren, Steuerlogik, Vier-Augen, Festschreiben',
						zustand: 'fertig',
						alsSchritt: 'Buchungsvorgang',
						schritte: [
							{ name: 'Buchungszeilen ableiten', zustand: 'done' },
							{ name: 'Validieren', zustand: 'done' },
							{ name: 'Freigabe Buchhalter', zustand: 'done' },
							{ name: 'Festschreiben', zustand: 'done' }
						],
						daten: {
							zeilen: [
								{ konto: '6805', bez: 'Telefon', soll: '747,90', haben: '' },
								{ konto: '1406', bez: 'Vorsteuer 19 %', soll: '142,10', haben: '' },
								{ konto: '3300', bez: 'Verbindlichkeiten aLuL', soll: '', haben: '890,00' }
							],
							summe: '890,00',
							festgeschrieben: 'Journal J-2026-0803 · 13.08.2026'
						}
					}
				]
			}
		]
	},
	{
		id: 'i-auszug',
		titel: 'Kontoauszug August · CSV',
		ziel: 'Die Umsätze einlesen und gegen die offenen Posten abgleichen.',
		quelle: 'aus Bank-Export „auszug-2026-08.csv"',
		erfasst: '19.08. 07:30',
		runs: [
			{
				id: 'r-auszug-inbox',
				skill: 'Inbox',
				skillId: 'inbox',
				flow: 'inbox-triage',
				zweck: 'Aus dem CSV lesbare Transaktionen machen',
				zustand: 'fertig',
				// DERSELBE Inbox-Flow wie beim Beleg — nur der andere Pfad:
				// die Triage schickt Auszüge über die Auszugsweiche, nicht
				// über die Belegextraktion.
				daten: { fakt: 'auszug-2026-08.csv · 18 Umsätze gelesen' },
				schritte: [
					{ name: 'Upload', zustand: 'done' },
					{ name: 'Annehmen', zustand: 'done' },
					{ name: 'Vorgänge trennen', zustand: 'done' },
					{ name: 'Klassifizieren', zustand: 'done' },
					{ name: 'Triage', zustand: 'done' },
					{ name: 'Auszugsweiche', zustand: 'done' },
					{ name: 'CSV parsen', zustand: 'done' },
					{ name: '→ Buchhaltung', zustand: 'done' }
				]
			},
			{
				id: 'r-auszug-abgleich',
				skill: 'Buchhaltung',
				skillId: 'buchhaltung',
				flow: 'zahlungsabgleich',
				zweck: 'Umsätze gegen offene Posten matchen',
				zustand: 'fertig',
				braucht: { run: 'r-auszug-inbox', was: 'Transaktionen (Übergabe)' },
				daten: { fakt: '15 von 18 Umsätzen automatisch abgeglichen — 3 an die Klärung' },
				schritte: [
					{ name: 'Transaktionen', zustand: 'done' },
					{ name: 'Zahlung matchen', zustand: 'done' },
					{ name: 'Abgeglichene Zahlungen', zustand: 'done' },
					{ name: '→ HITL', zustand: 'done' }
				]
			},
			{
				id: 'r-auszug-hitl',
				skill: 'HITL',
				skillId: 'hitl',
				flow: 'hitl-posteingang',
				zweck: 'Drei Umsätze ohne Gegenstück brauchen ein Urteil',
				zustand: 'wartet-mensch',
				braucht: { run: 'r-auszug-abgleich', was: 'Übergabe „unklar"' },
				schritte: [
					{ name: 'Unklares', zustand: 'done' },
					{ name: 'Nach Risiko sortieren', zustand: 'done' },
					{ name: 'Entscheiden', zustand: 'current' }
				],
				daten: {
					notiz: '−89,00 € · „AMAZON MKTP" · 16.08. — und 2 weitere ohne offenen Posten',
					befund: 'kein offener Posten passt · Risiko niedrig · 1 von 3',
					aktionen: ['zuordnen', 'als privat', 'vertagen']
				}
			}
		]
	},
	{
		id: 'i-monat',
		titel: 'Monatsabschluss August 2026',
		ziel: 'Alle Buchungen des Monats festschreiben und als EXTF an den Berater geben.',
		// Der Ursprung ist die PERIODE, kein Ereignis von außen: der
		// DATEV-Export läuft am Monatsende, nicht am Beleg.
		quelle: 'aus Periode „August 2026"',
		erfasst: '01.08.',
		runs: [
			{
				id: 'r-monat-export',
				skill: 'Buchhaltung',
				skillId: 'buchhaltung',
				flow: 'datev-export',
				zweck: 'Festgeschriebenes bündeln, Vorsteuer falten, EXTF schreiben',
				zustand: 'wartet-ergebnis',
				// Die große Abhängigkeit: nicht ein Geschwister-Lauf, sondern
				// GANZE Intents — jeder Beleg ist ein Intent, und der Monat
				// wartet auf sie alle.
				braucht: {
					intents: ['i-mueller', 'i-liefer', 'i-bergmann', 'i-weber', 'i-auszug'],
					was: 'alle Vorgänge des Monats festgeschrieben'
				},
				daten: { fakt: 'August 2026 · 1 von 5 Vorgängen abgeschlossen · EXTF wartet' },
				schritte: [
					{ name: 'Festgeschriebene Buchungen', zustand: 'blocked' },
					{ name: 'Stapel bilden', zustand: 'pending' },
					{ name: 'Vorsteuer falten', zustand: 'pending' },
					{ name: 'EXTF schreiben', zustand: 'pending' },
					{ name: 'Prüfen', zustand: 'pending' },
					{ name: 'EXTF-Datei', zustand: 'pending' }
				]
			}
		]
	}
]
