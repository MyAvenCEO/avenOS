/**
 * FiBu — the lowest booking primitive, hardcoded (board 0131).
 *
 * The unit of processing is the Rechnungsposition, not the Rechnung: one
 * position derives 1..n Buchungszeilen, and one Buchungszeile can draw on
 * several positions — so `positionIds` is an array, never a single ref. The
 * liability line references every position; a 70/30 split references the
 * same position twice. That n:m is the whole architectural lesson, and it
 * lives in the type.
 *
 * All amounts are integer cents; formatting is the view's job.
 */

export type Seite = 'soll' | 'haben'

export interface Position {
	id: string
	bezeichnung: string
	kategorie: string
	/** Netto in Cents. */
	netto: number
	/** USt-Satz in Prozent. */
	ustSatz: number
	/** USt in Cents. */
	ust: number
}

export interface Buchungszeile {
	konto: string
	seite: Seite
	/** Betrag in Cents. */
	betrag: number
	/** Which positions this line derives from — n:m, never a single ref. */
	positionIds: string[]
	/**
	 * Why this line is what it is, with the § that forces it. Shown instead
	 * of a green checkmark — the reviewer reads a reason, not a verdict.
	 */
	begruendung: string
	/** Marks abziehbare Vorsteuer (feeds UStVA Kz 66). */
	vorsteuer?: boolean
}

export interface Rechnung {
	id: string
	lieferant: string
	belegdatum: string
	/** Brutto in Cents — must equal the Haben side of the Buchungssatz. */
	brutto: number
	skontoHinweis?: string
	positionen: Position[]
	buchungszeilen: Buchungszeile[]
}

/**
 * The Härtetest from the FiBu context doc: one incoming invoice whose four
 * positions fan out into seven Soll lines, carrying the asymmetry between
 * Bewirtung (Aufwand 70/30 split, Vorsteuer fully deductible) and Geschenke
 * über 50 € (neither Aufwand nor Vorsteuer deductible — the USt becomes part
 * of the acquisition cost, so 714,00 hits the expense account and no
 * Vorsteuer line may ever reference the position).
 */
const eventAgentur: Rechnung = {
	id: 're-2026-0042',
	lieferant: 'Momentum Event GmbH',
	belegdatum: '2026-07-14',
	brutto: 573500,
	skontoHinweis: '2 % Skonto bei Zahlung binnen 10 Tagen',
	positionen: [
		{
			id: 'p-raum',
			bezeichnung: 'Raummiete Produkt-Launch',
			kategorie: 'Raumkosten',
			netto: 200000,
			ustSatz: 19,
			ust: 38000
		},
		{
			id: 'p-catering',
			bezeichnung: 'Catering (Bewirtung)',
			kategorie: 'Bewirtung',
			netto: 150000,
			ustSatz: 19,
			ust: 28500
		},
		{
			id: 'p-hotel',
			bezeichnung: 'Übernachtung Referenten',
			kategorie: 'Reisekosten',
			netto: 80000,
			ustSatz: 7,
			ust: 5600
		},
		{
			id: 'p-geschenke',
			bezeichnung: 'Werbegeschenke 10 × 60 €',
			kategorie: 'Geschenke',
			netto: 60000,
			ustSatz: 19,
			ust: 11400
		}
	],
	buchungszeilen: [
		{
			konto: 'Raumkosten',
			seite: 'soll',
			betrag: 200000,
			positionIds: ['p-raum'],
			begruendung: 'Anmietung für betriebliche Veranstaltung — voll abziehbar.'
		},
		{
			konto: 'Bewirtung abziehbar',
			seite: 'soll',
			betrag: 105000,
			positionIds: ['p-catering'],
			begruendung: '70 % des Bewirtungsaufwands abziehbar, § 4 Abs. 5 Nr. 2 EStG.'
		},
		{
			konto: 'Bewirtung nicht abziehbar',
			seite: 'soll',
			betrag: 45000,
			positionIds: ['p-catering'],
			begruendung:
				'30 % nicht abziehbar, § 4 Abs. 5 Nr. 2 EStG — Vorsteuer bleibt trotzdem voll abziehbar, § 15 Abs. 1a S. 2 UStG.'
		},
		{
			konto: 'Reisekosten Übernachtung',
			seite: 'soll',
			betrag: 80000,
			positionIds: ['p-hotel'],
			begruendung: 'Beherbergung zum ermäßigten Satz 7 %, § 12 Abs. 2 Nr. 11 UStG.'
		},
		{
			konto: 'Geschenke über 50 € nicht abziehbar',
			seite: 'soll',
			betrag: 71400,
			positionIds: ['p-geschenke'],
			begruendung:
				'Geschenk 60 € je Empfänger > 50-€-Grenze: Aufwand und Vorsteuer nicht abziehbar (§ 4 Abs. 5 Nr. 1 EStG, § 15 Abs. 1a UStG) — die USt von 114,00 wird Teil der Anschaffungskosten.'
		},
		{
			konto: 'Vorsteuer 19 %',
			seite: 'soll',
			betrag: 66500,
			positionIds: ['p-raum', 'p-catering'],
			begruendung:
				'Abziehbare Vorsteuer 19 % aus Raummiete und Bewirtung — der Geschenkeanteil bleibt draußen.',
			vorsteuer: true
		},
		{
			konto: 'Vorsteuer 7 %',
			seite: 'soll',
			betrag: 5600,
			positionIds: ['p-hotel'],
			begruendung: 'Abziehbare Vorsteuer 7 % aus der Übernachtung.',
			vorsteuer: true
		},
		{
			konto: 'Verbindlichkeiten aus L&L',
			seite: 'haben',
			betrag: 573500,
			positionIds: ['p-raum', 'p-catering', 'p-hotel', 'p-geschenke'],
			begruendung:
				'Bruttoverbindlichkeit gegenüber dem Lieferanten — eine Zeile aus allen Positionen.'
		}
	]
}

/** A plain one-position invoice: Hosting, 19 %, nothing special. */
const hosting: Rechnung = {
	id: 're-2026-0043',
	lieferant: 'Hetzner Online GmbH',
	belegdatum: '2026-07-31',
	brutto: 10591,
	positionen: [
		{
			id: 'p-server',
			bezeichnung: 'Dedicated Server AX42, Juli',
			kategorie: 'IT-Kosten',
			netto: 8900,
			ustSatz: 19,
			ust: 1691
		}
	],
	buchungszeilen: [
		{
			konto: 'IT- und Hostingkosten',
			seite: 'soll',
			betrag: 8900,
			positionIds: ['p-server'],
			begruendung: 'Laufende Serverkosten — voll abziehbar.'
		},
		{
			konto: 'Vorsteuer 19 %',
			seite: 'soll',
			betrag: 1691,
			positionIds: ['p-server'],
			begruendung: 'Abziehbare Vorsteuer 19 %, § 15 Abs. 1 UStG.',
			vorsteuer: true
		},
		{
			konto: 'Verbindlichkeiten aus L&L',
			seite: 'haben',
			betrag: 10591,
			positionIds: ['p-server'],
			begruendung: 'Bruttoverbindlichkeit gegenüber dem Lieferanten.'
		}
	]
}

/** Büromaterial, ebenfalls trivial — 19 %. */
const buerobedarf: Rechnung = {
	id: 're-2026-0044',
	lieferant: 'Bürobedarf Müller e.K.',
	belegdatum: '2026-08-03',
	brutto: 5355,
	positionen: [
		{
			id: 'p-material',
			bezeichnung: 'Druckerpapier & Toner',
			kategorie: 'Bürobedarf',
			netto: 4500,
			ustSatz: 19,
			ust: 855
		}
	],
	buchungszeilen: [
		{
			konto: 'Bürobedarf',
			seite: 'soll',
			betrag: 4500,
			positionIds: ['p-material'],
			begruendung: 'Verbrauchsmaterial — voll abziehbar.'
		},
		{
			konto: 'Vorsteuer 19 %',
			seite: 'soll',
			betrag: 855,
			positionIds: ['p-material'],
			begruendung: 'Abziehbare Vorsteuer 19 %, § 15 Abs. 1 UStG.',
			vorsteuer: true
		},
		{
			konto: 'Verbindlichkeiten aus L&L',
			seite: 'haben',
			betrag: 5355,
			positionIds: ['p-material'],
			begruendung: 'Bruttoverbindlichkeit gegenüber dem Lieferanten.'
		}
	]
}

/** Bahnfahrt zum ermäßigten Satz — der 7-%-Fall ohne Sonderlogik. */
const bahn: Rechnung = {
	id: 're-2026-0045',
	lieferant: 'DB Fernverkehr AG',
	belegdatum: '2026-08-06',
	brutto: 10700,
	positionen: [
		{
			id: 'p-ticket',
			bezeichnung: 'ICE München–Berlin, Kundentermin',
			kategorie: 'Reisekosten',
			netto: 10000,
			ustSatz: 7,
			ust: 700
		}
	],
	buchungszeilen: [
		{
			konto: 'Reisekosten Fahrt',
			seite: 'soll',
			betrag: 10000,
			positionIds: ['p-ticket'],
			begruendung: 'Personenbeförderung Bahn fern, ermäßigter Satz § 12 Abs. 2 Nr. 10 UStG.'
		},
		{
			konto: 'Vorsteuer 7 %',
			seite: 'soll',
			betrag: 700,
			positionIds: ['p-ticket'],
			begruendung: 'Abziehbare Vorsteuer 7 %, § 15 Abs. 1 UStG.',
			vorsteuer: true
		},
		{
			konto: 'Verbindlichkeiten aus L&L',
			seite: 'haben',
			betrag: 10700,
			positionIds: ['p-ticket'],
			begruendung: 'Bruttoverbindlichkeit gegenüber dem Lieferanten.'
		}
	]
}

export const rechnungen: Rechnung[] = [eventAgentur, hosting, buerobedarf, bahn]

/** Sum one side of a Buchungssatz, in cents. */
export function summe(rechnung: Rechnung, seite: Seite): number {
	return rechnung.buchungszeilen
		.filter((z) => z.seite === seite)
		.reduce((sum, z) => sum + z.betrag, 0)
}
