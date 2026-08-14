/**
 * Läufe — die Instanz-Seite des Rezept-Modells, hartkodiert.
 *
 * Die Skills-Ansicht zeigt Flows als DEFINITION: was könnte passieren.
 * Hier steht das Gegenstück: was ist tatsächlich passiert. Ein Lauf ist
 * ein Gegenstand, der einen Flow durchquert — mit einem Weg hinter sich,
 * einer Position und (wenn er wartet) einem Menschen davor.
 *
 * Bewusst nur vier Felder Zustand, weil mehr für die Ansicht nicht nötig
 * ist: WO er steht (`bei`), WIE er dorthin kam (`weg`), WAS mitläuft
 * (`gegenstand`) und WOFÜR das steht (`titel`/`kurz`). Alles andere — die
 * Schrittnamen, die möglichen Aktionen, die Sinks — liest die Ansicht aus
 * dem Rezept. Deshalb funktioniert derselbe Viewer für jeden Flow: das
 * letzte Beispiel unten ist absichtlich ein Buchhaltungs-Lauf.
 */

export type RunStatus = 'laeuft' | 'wartet' | 'fertig'

export interface FlowRun {
	id: string
	/** Rezept-Id aus der flachen Flow-Registry. */
	flow: string
	titel: string
	/** Eine Zeile, die in die Aside passt. */
	kurz: string
	erfasst: string
	status: RunStatus
	/** Die aktuelle Position: eine Knoten-Id des Rezepts. */
	bei: string
	/**
	 * Der zurückgelegte Weg, in Reihenfolge — jeder Halt mit Ergebnis.
	 *
	 * `guete` trägt die Konfidenz je Klasse, wo ein Schritt einordnet: das
	 * Rezept verlangt sie ("Konfidenz pflicht", Schwelle im Config), also
	 * gehört sie in den Lauf und nicht in die Ansicht. Ohne sie könnte ein
	 * Mensch nicht sehen, ob ein Urteil knapp oder klar war.
	 */
	weg: { node: string; um: string; ergebnis?: string; guete?: Record<string, number> }[]
	/** Was durch den Flow läuft. Frei geformt, die Ansicht zeigt es als Kartentext. */
	gegenstand: Record<string, string>
}

export const runs: FlowRun[] = [
	{
		id: 'r-001',
		flow: 'intents-triage',
		titel: 'Prolog-Actor als Blatt',
		kurz: 'Idee · liegt auf dem Board',
		erfasst: '2026-08-14T09:12:00',
		status: 'fertig',
		bei: 'out-board',
		weg: [
			{ node: 'in-notiz', um: '09:12' },
			{
				node: 'klassifizieren',
				um: '09:12',
				ergebnis: 'idee',
				guete: { idee: 0.88, todo: 0.07, unbekannt: 0.05 }
			},
			{ node: 'weiche', um: '09:12', ergebnis: 'Zweig idee' },
			{ node: 'als-idee-anlegen', um: '09:12', ergebnis: 'Eintrag #14 angelegt' }
		],
		gegenstand: {
			notiz:
				'Trealla als eigener Actor, nicht im Bus — die Mesh könnte sich damit selbst befragen: welche Actors füttern wen, was hängt an workitem.',
			titel: 'Prolog-Actor als Blatt'
		}
	},
	{
		id: 'r-002',
		flow: 'intents-triage',
		titel: 'Fibu-Ordner umbenennen',
		kurz: 'Todo · steht auf der Liste',
		erfasst: '2026-08-14T10:03:00',
		status: 'fertig',
		bei: 'out-todos',
		weg: [
			{ node: 'in-notiz', um: '10:03' },
			{
				node: 'klassifizieren',
				um: '10:03',
				ergebnis: 'todo',
				guete: { todo: 0.81, idee: 0.13, unbekannt: 0.06 }
			},
			{ node: 'weiche', um: '10:03', ergebnis: 'Zweig todo' },
			{ node: 'als-todo-anlegen', um: '10:03', ergebnis: 'Eintrag #7 angelegt' }
		],
		gegenstand: {
			notiz:
				'lib/fibu heißt noch fibu, hält aber längst das generische Flow-Modell plus Intents — nach flows/ umbenennen.',
			todo: 'Verzeichnis lib/fibu → lib/flows umbenennen'
		}
	},
	{
		id: 'r-003',
		flow: 'intents-triage',
		titel: 'Notiz-Fetzen vom Spaziergang',
		kurz: 'Unbekannt · wartet auf Einordnung',
		erfasst: '2026-08-14T10:41:00',
		status: 'wartet',
		bei: 'unklares-einordnen',
		weg: [
			{ node: 'in-notiz', um: '10:41' },
			{
				node: 'klassifizieren',
				um: '10:41',
				ergebnis: 'unbekannt (keine Klasse über der Schwelle)',
				// Höchster Wert 0,41 — unter 0,6, also Rückfall statt Rateversuch.
				guete: { idee: 0.41, unbekannt: 0.34, todo: 0.25 }
			},
			{ node: 'weiche', um: '10:41', ergebnis: 'Zweig unbekannt' }
		],
		gegenstand: {
			notiz: 'irgendwas mit Sichtbarkeit und Vertrauen — später nochmal denken'
		}
	},
	{
		id: 'r-004',
		flow: 'intents-triage',
		titel: 'Board sortiert nach Datum',
		kurz: 'Idee · liegt auf dem Board',
		erfasst: '2026-08-13T18:22:00',
		status: 'fertig',
		bei: 'out-board',
		weg: [
			{ node: 'in-notiz', um: '18:22' },
			{
				node: 'klassifizieren',
				um: '18:22',
				ergebnis: 'idee',
				guete: { idee: 0.93, todo: 0.04, unbekannt: 0.03 }
			},
			{ node: 'weiche', um: '18:22', ergebnis: 'Zweig idee' },
			{ node: 'als-idee-anlegen', um: '18:22', ergebnis: 'Eintrag #11 angelegt' }
		],
		gegenstand: {
			notiz:
				'Das Ideen-Board könnte nach Erfassung sortieren statt alphabetisch — das Neueste ist meistens das Lebendigste.',
			titel: 'Board sortiert nach Datum'
		}
	},
	{
		id: 'r-005',
		flow: 'intents-triage',
		titel: 'Stall-Watchdog auch für die Voice-Lane',
		kurz: 'Unklar · von Hand als Todo abgelegt',
		erfasst: '2026-08-13T16:05:00',
		status: 'fertig',
		bei: 'out-erledigt',
		weg: [
			{ node: 'in-notiz', um: '16:05' },
			{
				node: 'klassifizieren',
				um: '16:05',
				// Knapp unter der Schwelle: das Modell tendierte zu Todo, durfte
				// aber nicht — die Klasse kam dann vom Menschen.
				ergebnis: 'unbekannt (keine Klasse über der Schwelle)',
				guete: { todo: 0.55, idee: 0.29, unbekannt: 0.16 }
			},
			{ node: 'weiche', um: '16:05', ergebnis: 'Zweig unbekannt' },
			{ node: 'unklares-einordnen', um: '16:31', ergebnis: 'als-todo · Samuel' }
		],
		gegenstand: {
			notiz:
				'Der 75s-Watchdog hängt nur an der Design-Lane. Die Voice-Lane kann genauso stillstehen.',
			todo: 'Stall-Watchdog auf die Voice-Lane ausweiten'
		}
	},
	{
		id: 'r-006',
		flow: 'intents-triage',
		titel: 'Frisch reingekommen',
		kurz: 'Wird gerade eingeordnet',
		erfasst: '2026-08-14T11:58:00',
		status: 'laeuft',
		bei: 'klassifizieren',
		weg: [{ node: 'in-notiz', um: '11:58' }],
		gegenstand: {
			notiz:
				'Ein Run-Viewer, der aus dem Rezept rendert statt aus einer zweiten Wahrheit — dann stimmen Definition und Lauf immer überein.'
		}
	},
	{
		id: 'r-007',
		flow: 'inbox-triage',
		titel: 'Scan vom 12.08. — Lieferschein?',
		kurz: 'An HITL übergeben · anderer Flow, gleicher Viewer',
		erfasst: '2026-08-12T08:44:00',
		status: 'fertig',
		bei: 'an-hitl',
		weg: [
			{ node: 'in-upload', um: '08:44' },
			{ node: 'annehmen', um: '08:44', ergebnis: 'normalisiert' },
			{ node: 'trennen', um: '08:45', ergebnis: '1 Vorgang' },
			{
				node: 'klassifizieren',
				um: '08:45',
				ergebnis: 'keine Klasse über der Schwelle',
				guete: { beleg: 0.62, transaktionen: 0.11 }
			},
			{ node: 'triage', um: '08:45', ergebnis: 'Zweig unbekannt' }
		],
		gegenstand: {
			datei: 'scan-2026-08-12-0003.pdf',
			befund: 'Kein Belegtyp über der Schwelle — weder Rechnung noch Kontoauszug.'
		}
	}
]
