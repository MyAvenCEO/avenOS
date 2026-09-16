/** Deterministic, fictional 180-day lives for long-horizon retrieval tests. */

export const CORPUS_START = '2026-01-01'
export const CORPUS_DAYS = 180

export type CorpusLanguage = 'de' | 'es' | 'en' | 'pt'
export type CorpusDomain = 'personal' | 'business'
export type CorpusStatus = 'working' | 'waiting' | 'done' | 'archive'

export interface PersonaProfile {
	id: string
	name: string
	language: CorpusLanguage
	city: string
	personalLife: string
	businessLife: string
	household: string
	businessOperations: string
	paymentMethods: string[]
	providers: string[]
	recurringObligations: string[]
	writingStyle: string
}

export interface PersonaContact {
	id: string
	personaId: string
	name: string
	role: string
	organization: string | null
	language: CorpusLanguage
	relationship: string
	intentKeys: string[]
	writingStyle: string
}

export interface CorpusIntent {
	id: string
	personaId: string
	domain: CorpusDomain
	title: string
	type: string
	source: string
	routingSummary: string
	createdAt: string
	updatedAt: string
	status: CorpusStatus
	core: boolean
}

export interface CorpusMessage {
	id: string
	personaId: string
	intentId: string
	createdAt: string
	dayIndex: number
	role: 'user' | 'assistant'
	kind: 'check-in' | 'decision' | 'correction' | 'blocker' | 'resolution' | 'one-off' | 'episode'
	content: string
}

export interface CorpusDay {
	personaId: string
	date: string
	dayIndex: number
	selectedIntentId: string
	recentIntentIds: string[]
	createdIntentIds: string[]
	touchedIntentIds: string[]
	createdArtifactIds: string[]
	activeCount: number
	waitingCount: number
}

export interface CorpusProbe {
	id: string
	personaId: string
	language: CorpusLanguage
	question: string
	targetIntentId: string | null
	expectedAnswer: string | null
	answerMode:
		| 'historical'
		| 'latest-correction'
		| 'current-blocker'
		| 'cross-language'
		| 'not-found'
	anchorDay: number | null
	askDayIndex?: number
	askDate?: string
	targetArtifactId?: string
}

export interface CorpusArtifact {
	id: string
	personaId: string
	intentId: string
	dayIndex: number
	createdAt: string
	kind:
		| 'email'
		| 'document'
		| 'calendar'
		| 'todo'
		| 'receipt'
		| 'transport-ticket'
		| 'event-ticket'
		| 'voucher'
		| 'booking'
		| 'transaction'
		| 'order'
		| 'return'
		| 'support'
		| 'legal'
		| 'invoice'
		| 'payment'
		| 'card-statement'
		| 'bank-statement'
	language: CorpusLanguage
	title: string
	from: string
	to: string | null
	body: string
	supersedesId: string | null
	assetPath?: string
}

export interface PersonaCorpus {
	version: 2
	startDate: string
	dayCount: number
	personas: PersonaProfile[]
	contacts: PersonaContact[]
	intents: CorpusIntent[]
	messages: CorpusMessage[]
	artifacts: CorpusArtifact[]
	days: CorpusDay[]
	probes: CorpusProbe[]
}

interface Arc {
	key: string
	domain: CorpusDomain
	title: string
	summary: string
	beats: [string, string, string, string]
	nextAction: string
	waitFrom?: number
	waitFor?: string
	resolvedAt?: number
	doneAt?: number
	archiveAt?: number
}

interface Anchor {
	day: number
	arc: string
	kind: CorpusMessage['kind']
	user: string
	assistant: string
}

interface ArtifactAnchor {
	day: number
	arc: string
	id: string
	kind: CorpusArtifact['kind']
	language: CorpusLanguage
	title: string
	from: string
	to: string | null
	body: string
	supersedesId?: string
}

interface PersonaConfig {
	profile: PersonaProfile
	contacts: Array<Omit<PersonaContact, 'personaId' | 'writingStyle'> & { writingStyle?: string }>
	arcs: Arc[]
	anchors: Anchor[]
	artifactAnchors: ArtifactAnchor[]
	probes: Array<Omit<CorpusProbe, 'targetIntentId'> & { arc: string | null }>
	oneOffs: { personal: string[]; business: string[] }
	phrases: {
		checkIn: (title: string, beat: string, date: string) => string
		reply: (nextAction: string, state: CorpusStatus, date: string) => string
		oneOff: (title: string, date: string) => string
		oneOffReply: (title: string) => string
		followUp: (title: string, date: string) => string
		followUpReply: (title: string) => string
	}
}

const lena: PersonaConfig = {
	profile: {
		id: 'lena-weber',
		name: 'Lena Weber',
		language: 'de',
		city: 'Berlin',
		personalLife:
			'Shares a flat with her partner; helps her father manage appointments and is preparing a move.',
		businessLife:
			'Runs a small ceramics workshop with classes, online orders, suppliers, and two part-time instructors.',
		household:
			"Lives with partner Mira; coordinates her father Klaus's accessible travel. They split rent and keep a move reserve. Class weekends compete with family trips.",
		businessOperations:
			'Studio sells through its own storefront and occasional Etsy orders; Stripe settles card sales, PayPal covers small supplies. Lena pays instructors monthly, tracks German VAT, and negotiates a studio lease and supplier terms.',
		paymentMethods: [
			'fictional Visa debit ending 4821',
			'PayPal business account',
			'Stripe storefront payouts',
			'SEPA bank transfer'
		],
		providers: [
			'BVG',
			'Deutsche Bahn',
			'DHL',
			'Etsy',
			'PayPal',
			'Stripe',
			'Nordton',
			'Berlin Hausverwaltung'
		],
		recurringObligations: [
			'studio rent and utilities',
			'monthly instructor invoices',
			'glaze and clay purchases',
			'household rent split',
			'father clinic transport',
			'VAT bookkeeping'
		],
		writingStyle:
			'In quick German chat Lena is direct and sometimes drops punctuation or uses colloquial shortcuts. She becomes careful and complete with customers, insurers and legal terms. Occasional harmless phone typos are plausible.'
	},
	contacts: [
		{
			id: 'lena-mira',
			name: 'Mira',
			role: 'partner',
			organization: null,
			language: 'de',
			relationship:
				'Shares the household budget and summer move; prefers decisions before weekend classes are booked.',
			intentKeys: ['flat-move', 'home-budget', 'family-weekend']
		},
		{
			id: 'lena-klaus',
			name: 'Klaus Weber',
			role: 'father',
			organization: null,
			language: 'de',
			relationship:
				'Needs accessible clinic travel and clear appointment reminders; Lena handles coordination with his consent.',
			intentKeys: ['father-clinic', 'family-weekend']
		},
		{
			id: 'lena-eva',
			name: 'Eva Richter',
			role: 'instructor',
			organization: 'Weber Keramik',
			language: 'de',
			relationship:
				'Part-time instructor whose holiday and monthly teaching hours affect class coverage.',
			intentKeys: ['classes', 'cashflow']
		},
		{
			id: 'lena-jonas',
			name: 'Jonas Beck',
			role: 'instructor',
			organization: 'Weber Keramik',
			language: 'de',
			relationship: 'Covers kiln demonstrations and may swap Saturday classes with Eva.',
			intentKeys: ['classes', 'orders']
		},
		{
			id: 'lena-timo',
			name: 'Timo Falk',
			role: 'supplier account manager',
			organization: 'Nordton',
			language: 'de',
			relationship:
				'Confirms glaze price revisions and batch releases; written terms outrank earlier calls.',
			intentKeys: ['glaze-supplier', 'cashflow']
		},
		{
			id: 'lena-becker',
			name: 'Frau Becker',
			role: 'landlord representative',
			organization: 'Berlin Hausverwaltung',
			language: 'de',
			relationship:
				'Negotiates studio lease wording and requires the fire-safety report before evening classes.',
			intentKeys: ['studio-lease']
		},
		{
			id: 'lena-paul',
			name: 'Paul Neumann',
			role: 'fire-safety engineer',
			organization: 'Neumann Brandschutz',
			language: 'de',
			relationship: 'Must sign report B-17; a verbal assurance does not release the lease blocker.',
			intentKeys: ['studio-lease']
		},
		{
			id: 'lena-maier',
			name: 'Dr. Lea Maier',
			role: 'business lawyer',
			organization: 'Kanzlei Maier',
			language: 'de',
			relationship:
				'Reviews studio lease and supplier clauses; distinguishes draft wording from signed terms.',
			intentKeys: ['studio-lease', 'glaze-supplier']
		},
		{
			id: 'lena-amira',
			name: 'Amira Yilmaz',
			role: 'customer',
			organization: null,
			language: 'de',
			relationship: 'Buys handmade tableware and asks for reliable delivery and damage handling.',
			intentKeys: ['orders']
		},
		{
			id: 'lena-nils',
			name: 'Nils Hartmann',
			role: 'support employee',
			organization: 'DHL',
			language: 'de',
			relationship:
				'Handles parcel traces and damage claims; needs photo evidence and tracking references.',
			intentKeys: ['orders']
		},
		{
			id: 'lena-britta',
			name: 'Britta Seidel',
			role: 'friend',
			organization: null,
			language: 'de',
			relationship:
				'Helps with move boxes and occasional cycling routes, but cannot cover studio classes.',
			intentKeys: ['flat-move', 'bike']
		},
		{
			id: 'lena-sara',
			name: 'Sara Lenz',
			role: 'payment support employee',
			organization: 'PayPal',
			language: 'de',
			relationship:
				'Investigates small-supply refunds and payout holds; replies by case reference.',
			intentKeys: ['cashflow', 'orders']
		},
		{
			id: 'lena-nora',
			name: 'Nora Wells',
			role: 'quality support employee',
			organization: 'Nordton export desk',
			language: 'en',
			relationship:
				'Replies in English about glaze sample release and shipping, while Timo handles German pricing.',
			intentKeys: ['glaze-supplier', 'orders']
		},
		{
			id: 'lena-olivia',
			name: 'Olivia Grant',
			role: 'international customer',
			organization: null,
			language: 'en',
			relationship:
				'Orders ceramics as a gift and writes English support emails about fragile shipping.',
			intentKeys: ['orders', 'classes']
		}
	],
	arcs: [
		{
			key: 'studio-lease',
			domain: 'business',
			title: 'Werkstatt-Mietvertrag und Brandschutz',
			summary: 'Renew the studio lease while clearing the fire-safety approval.',
			beats: [
				'Vermieterin um den Vertragsentwurf bitten',
				'Fluchtwegplan mit den Kurszeiten abgleichen',
				'Versicherungsnachweis zusammenstellen',
				'Offene Klausel zu Abendkursen prüfen'
			],
			nextAction: 'die fehlende Freigabe mit Paul und der Vermieterin klären',
			waitFrom: 145,
			waitFor: 'Pauls unterschriebener Bericht B-17'
		},
		{
			key: 'glaze-supplier',
			domain: 'business',
			title: 'Glasur-Liefervertrag Nordton',
			summary: 'Track Nordton glaze prices, samples, and batch releases.',
			beats: [
				'Musterplatten für die neue Glasur prüfen',
				'Preisstaffel mit Nordton vergleichen',
				'Lieferfenster für die Kurse abstimmen',
				'Chargenblatt für die Brennöfen ablegen'
			],
			nextAction: 'die bestätigten Konditionen und Chargen für den nächsten Einkauf verwenden'
		},
		{
			key: 'classes',
			domain: 'business',
			title: 'Frühlingskurse und Dozentenplan',
			summary: 'Schedule classes and cover instructor absences.',
			beats: [
				'Samstagskurs auf freie Plätze prüfen',
				'Evas Urlaub gegen die Kursliste halten',
				'Warteliste für Anfänger öffnen',
				'Tonbedarf pro Kurs nachrechnen'
			],
			nextAction: 'den Kursplan mit Eva und Jonas bestätigen'
		},
		{
			key: 'orders',
			domain: 'business',
			title: 'Online-Bestellungen und Versand',
			summary: 'Ship fragile ceramics and resolve returns without losing order history.',
			beats: [
				'Bruchquote der letzten Pakete prüfen',
				'Verpackungsproben testen',
				'Rücksendung aus Hamburg beantworten',
				'Abholtermin mit dem Paketdienst abstimmen'
			],
			nextAction: 'die offenen Pakete mit Fotos und Sendungsnummern abgleichen'
		},
		{
			key: 'cashflow',
			domain: 'business',
			title: 'Werkstatt-Cashflow und Rechnungen',
			summary: 'Reconcile classes, materials, deposits, and overdue invoices.',
			beats: [
				'Kursanzahlungen den Rechnungen zuordnen',
				'Materialkosten des Monats abgleichen',
				'Überfällige Atelier-Rechnung nachfassen',
				'Reserve für Reparaturen nachrechnen'
			],
			nextAction: 'die offenen Posten mit den Belegen abgleichen'
		},
		{
			key: 'father-clinic',
			domain: 'personal',
			title: 'Termine und Fahrten für Vater',
			summary: 'Coordinate her father’s clinic visits and accessible travel.',
			beats: [
				'Fahrt zur Klinik mit Vater abstimmen',
				'Medikamentenliste für den Termin prüfen',
				'Rückruf der Praxis notieren',
				'Begleitung für den Untersuchungstag organisieren'
			],
			nextAction: 'die bestätigte Fahrt und den Praxiseingang mit Vater teilen'
		},
		{
			key: 'flat-move',
			domain: 'personal',
			title: 'Wohnungswechsel im Sommer',
			summary: 'Plan the move, deposits, utilities, and handover.',
			beats: [
				'Übergabeprotokoll vorbereiten',
				'Kartons und Transporter vergleichen',
				'Stromwechsel terminieren',
				'Kaution und Mietbeginn abgleichen'
			],
			nextAction: 'die nächsten Termine mit dem Hausverwalter bestätigen'
		},
		{
			key: 'bike',
			domain: 'personal',
			title: 'Rad und täglicher Arbeitsweg',
			summary: 'Repair her bicycle and choose a safe commute during the move.',
			beats: [
				'Bremsen nach der Werkstattfahrt testen',
				'Schlechtwetter-Route planen',
				'Ersatzteilangebot prüfen',
				'Fahrradstellplatz an der neuen Wohnung klären'
			],
			nextAction: 'den Werkstatttermin und die Pendelroute festhalten'
		},
		{
			key: 'family-weekend',
			domain: 'personal',
			title: 'Familienwochenende an der Ostsee',
			summary: 'Arrange an accessible family weekend without clashing with studio classes.',
			beats: [
				'Bahntickets mit den Kursen vergleichen',
				'Barrierearme Unterkunft prüfen',
				'Vaters Reisetag abstimmen',
				'Packliste und Rückfahrt klären'
			],
			nextAction: 'die bestätigten Fahrkarten und Zeiten teilen',
			doneAt: 155,
			archiveAt: 165
		},
		{
			key: 'home-budget',
			domain: 'personal',
			title: 'Haushaltsbudget und Rücklage',
			summary: 'Keep the move and family travel inside a shared savings plan.',
			beats: [
				'Gemeinsame Ausgaben des Monats sortieren',
				'Umzugspuffer neu berechnen',
				'Reisekosten der Ostsee-Fahrt prüfen',
				'Dauerauftrag für die Rücklage vergleichen'
			],
			nextAction: 'die Rücklage mit dem tatsächlichen Kontostand abstimmen'
		}
	],
	anchors: [
		{
			day: 14,
			arc: 'glaze-supplier',
			kind: 'decision',
			user: 'Nordton hat 4,20 Euro pro Kilo Glasur bestätigt. Das gilt für die Frühjahrskurse.',
			assistant: 'Ich halte 4,20 Euro je Kilo als damalige bestätigte Preisstaffel fest.'
		},
		{
			day: 116,
			arc: 'glaze-supplier',
			kind: 'correction',
			user: 'Die neue bestätigte Nordton-Staffel beträgt 4,65 Euro pro Kilo. Sie ersetzt die alte Zahl von 4,20 Euro.',
			assistant:
				'Für den nächsten Einkauf gilt jetzt 4,65 Euro je Kilo; 4,20 Euro ist die überholte Frühjahrsstaffel.'
		},
		{
			day: 38,
			arc: 'father-clinic',
			kind: 'decision',
			user: 'Für Vaters Kliniktermin nehmen wir Eingang Nord, nicht die Hauptpforte. Dort hält der barrierefreie Shuttle.',
			assistant: 'Eingang Nord ist für die Fahrt und den barrierefreien Shuttle notiert.'
		},
		{
			day: 91,
			arc: 'glaze-supplier',
			kind: 'decision',
			user: 'Nordton wrote in English: The glaze batch release code is BLUE-271. Please keep it with the kiln samples.',
			assistant:
				'Ich habe BLUE-271 bei den Glasurmustern abgelegt und werde die Freigabe damit zuordnen.'
		},
		{
			day: 151,
			arc: 'studio-lease',
			kind: 'blocker',
			user: 'Der Werkstattvertrag wartet noch auf Pauls unterschriebenen Brandschutzbericht B-17. Ohne den Bericht keine Abendkurse im neuen Vertrag.',
			assistant:
				'Die offene Blockade ist Pauls unterschriebener Bericht B-17; bis dahin bleibt die Verlängerung wartend.'
		}
	],
	artifactAnchors: [
		{
			day: 14,
			arc: 'glaze-supplier',
			id: 'lena-nordton-spring-quote',
			kind: 'email',
			language: 'de',
			title: 'Nordton: Frühjahrsstaffel Glasur',
			from: 'Nordton Einkauf',
			to: 'Lena Weber',
			body: 'Hallo Lena, für die Frühjahrskurse bestätigen wir 4,20 Euro je Kilo. Die Staffel gilt nur bis zur neuen Jahresvereinbarung.'
		},
		{
			day: 91,
			arc: 'glaze-supplier',
			id: 'lena-nordton-batch-mail',
			kind: 'email',
			language: 'en',
			title: 'Glaze batch release and kiln samples',
			from: 'Nordton quality desk',
			to: 'Lena Weber',
			body: 'The glaze batch release code is BLUE-271. Attach it to the kiln sample sheet before ordering the next batch.'
		},
		{
			day: 116,
			arc: 'glaze-supplier',
			id: 'lena-nordton-current-terms',
			kind: 'document',
			language: 'de',
			title: 'Nordton Konditionen 2026 – freigegeben',
			from: 'Nordton Vertragsablage',
			to: null,
			body: 'Freigegebene Preisstaffel: 4,65 Euro je Kilo Glasur. Diese Fassung ersetzt die Frühjahrsstaffel von 4,20 Euro. Gültig für den nächsten Einkauf.',
			supersedesId: 'lena-nordton-spring-quote'
		},
		{
			day: 151,
			arc: 'studio-lease',
			id: 'lena-lease-draft',
			kind: 'document',
			language: 'de',
			title: 'Werkstattmiete – Entwurf und offene Freigabe',
			from: 'Hausverwaltung',
			to: null,
			body: 'Abendkurse bleiben in der Verlängerung gesperrt, bis Pauls unterschriebener Brandschutzbericht B-17 vorliegt. Der Entwurf ist noch nicht final.'
		},
		{
			day: 38,
			arc: 'father-clinic',
			id: 'lena-clinic-travel-note',
			kind: 'document',
			language: 'de',
			title: 'Fahrt zur Klinik für Vater',
			from: 'Lena Weber',
			to: null,
			body: 'Barrierefreier Shuttle: Eingang Nord. Nicht an der Hauptpforte warten. Vater vor Abfahrt anrufen.'
		}
	],
	probes: [
		{
			id: 'lena-current-glaze-price',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Welcher Nordton-Preis gilt jetzt, nachdem wir ihn geändert hatten?',
			arc: 'glaze-supplier',
			expectedAnswer: '4,65 Euro',
			answerMode: 'latest-correction',
			anchorDay: 116
		},
		{
			id: 'lena-clinic-entrance',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Welchen Eingang hatten wir für Vaters Klinikfahrt festgelegt?',
			arc: 'father-clinic',
			expectedAnswer: 'Eingang Nord',
			answerMode: 'historical',
			anchorDay: 38
		},
		{
			id: 'lena-english-batch-code',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Welche Freigabenummer stand in der englischen Nordton-Mail?',
			arc: 'glaze-supplier',
			expectedAnswer: 'BLUE-271',
			answerMode: 'cross-language',
			anchorDay: 91,
			targetArtifactId: 'lena-nordton-batch-mail'
		},
		{
			id: 'lena-signed-glaze-document',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Was steht in den freigegebenen Nordton-Konditionen zum Kilopreis?',
			arc: 'glaze-supplier',
			expectedAnswer: '4,65 Euro',
			answerMode: 'latest-correction',
			anchorDay: 116,
			targetArtifactId: 'lena-nordton-current-terms'
		},
		{
			id: 'lena-lease-blocker',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Was blockiert den Werkstattvertrag noch?',
			arc: 'studio-lease',
			expectedAnswer: 'B-17',
			answerMode: 'current-blocker',
			anchorDay: 151
		},
		{
			id: 'lena-lease-draft-document',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Was fordert der Mietvertragsentwurf vor den Abendkursen?',
			arc: 'studio-lease',
			expectedAnswer: 'B-17',
			answerMode: 'current-blocker',
			anchorDay: 151,
			targetArtifactId: 'lena-lease-draft'
		},
		{
			id: 'lena-missing-pin',
			personaId: 'lena-weber',
			language: 'de',
			question: 'Welche geheime PIN hatten wir für die Werkstatt vereinbart?',
			arc: null,
			expectedAnswer: null,
			answerMode: 'not-found',
			anchorDay: null
		}
	],
	oneOffs: {
		personal: [
			'Paket für Vater abholen',
			'Küchentisch reparieren',
			'Zahnarzttermin verschieben',
			'Bücher für den Umzug sortieren',
			'Geburtstagsessen organisieren',
			'Bahnfahrkarte prüfen',
			'Nebenkostenbeleg finden',
			'Pflanzen für den Balkon besorgen',
			'Schlüsselkopie machen',
			'Regenjacke ersetzen'
		],
		business: [
			'Rechnung für Töpferkurs prüfen',
			'Glasurmuster fotografieren',
			'Versandetikett korrigieren',
			'Kundenfrage zur Schale beantworten',
			'Ofenwartung terminieren',
			'Kursmaterial bestellen',
			'Lieferantenbeleg ablegen',
			'Workshop-Anfrage beantworten',
			'Website-Foto freigeben',
			'Dozentenstunde abrechnen'
		]
	},
	phrases: {
		checkIn: (title, beat, date) =>
			`Zu ${title} am ${date}: ${beat}. Was ist jetzt der nächste Schritt?`,
		reply: (nextAction, state, date) =>
			`Stand ${date}: ${state === 'waiting' ? 'Die Sache wartet noch.' : 'Wir können weiterarbeiten.'} Als Nächstes ${nextAction}.`,
		oneOff: (title, date) =>
			`Für ${date}: Bitte ${title.toLowerCase()} und die Details festhalten.`,
		oneOffReply: (title) =>
			`Ich habe ${title.toLowerCase()} als eigene Sache angelegt und die nächsten Angaben gesammelt.`,
		followUp: (title, date) =>
			`Ist ${title.toLowerCase()} am ${date} erledigt oder fehlt noch etwas?`,
		followUpReply: (title) =>
			`${title} ist mit dem letzten Beleg abgeschlossen und kann ins Archiv.`
	}
}

const sofia: PersonaConfig = {
	profile: {
		id: 'sofia-morales',
		name: 'Sofía Morales',
		language: 'es',
		city: 'Valencia',
		personalLife:
			'Co-parents a school-age child, trains for a half marathon, and helps her mother with appointments.',
		businessLife:
			'Owns a small floral and event studio with wedding deliveries, seasonal staff, and a refrigerated workspace.',
		household:
			'Co-parents Nico with ex-partner Tomás; school pickups alternate. Her mother Pilar needs clinic transport. Training and visits to Oporto must fit event weekends.',
		businessOperations:
			'Wedding deposits arrive by bank transfer or Stripe; Bizum handles small local reimbursements. Sofía buys flowers from Mar Azul and pays seasonal staff, van hire, refrigeration service, and Spanish IVA.',
		paymentMethods: [
			'fictional Visa credit ending 6418',
			'Bizum personal transfers',
			'Stripe event deposits',
			'SEPA bank transfer'
		],
		providers: [
			'Renfe',
			'EMT Valencia',
			'Correos',
			'Bizum',
			'Stripe',
			'Mar Azul',
			'Taller Alba',
			'Valencia event venues'
		],
		recurringObligations: [
			'cold-room electricity and maintenance',
			'seasonal staff payroll',
			'flower supplier invoices',
			'school costs shared with Tomás',
			'clinic rides for Pilar',
			'quarterly IVA records'
		],
		writingStyle:
			'Sofía sends fast, warm Spanish messages and voice-to-text fragments to family and staff, sometimes missing accents. Client quotes are polished; she is firm but friendly when chasing a deposit or service repair.'
	},
	contacts: [
		{
			id: 'sofia-nico',
			name: 'Nico',
			role: 'child',
			organization: null,
			language: 'es',
			relationship:
				'School-age son; school trips and pickup arrangements are planned between two households.',
			intentKeys: ['school', 'home-budget', 'porto-visit']
		},
		{
			id: 'sofia-tomas',
			name: 'Tomás Vidal',
			role: 'co-parent',
			organization: null,
			language: 'es',
			relationship:
				'Shares school costs and alternating pickups; changes need direct confirmation.',
			intentKeys: ['school', 'home-budget', 'porto-visit']
		},
		{
			id: 'sofia-pilar',
			name: 'Pilar Morales',
			role: 'mother',
			organization: null,
			language: 'es',
			relationship:
				'Needs help arranging clinic transport and keeping the newest appointment time.',
			intentKeys: ['mother-clinic', 'porto-visit']
		},
		{
			id: 'sofia-lucia',
			name: 'Lucía Ferrer',
			role: 'seasonal florist',
			organization: 'Estudio Morales',
			language: 'es',
			relationship: 'Leads venue setup shifts and records extra hours for payroll.',
			intentKeys: ['staff', 'valencia-wedding']
		},
		{
			id: 'sofia-mario',
			name: 'Mario Costa',
			role: 'seasonal florist',
			organization: 'Estudio Morales',
			language: 'es',
			relationship: 'Covers loading and cold-room checks; needs clear handoff notes.',
			intentKeys: ['staff', 'cold-room']
		},
		{
			id: 'sofia-isabel',
			name: 'Isabel Ríos',
			role: 'supplier account manager',
			organization: 'Mar Azul',
			language: 'es',
			relationship: 'Handles substitutions, unloading windows and invoices for flowers.',
			intentKeys: ['flower-supplier', 'quotes']
		},
		{
			id: 'sofia-alba',
			name: 'Alba Pérez',
			role: 'refrigeration technician',
			organization: 'Taller Alba',
			language: 'es',
			relationship:
				'Diagnoses the cooling fault and confirms temperature before delicate flowers return.',
			intentKeys: ['cold-room']
		},
		{
			id: 'sofia-clara',
			name: 'Clara Beltrán',
			role: 'wedding customer',
			organization: null,
			language: 'es',
			relationship:
				'Wants the Valencia flowers delivered on time and deposit changes explained in writing.',
			intentKeys: ['valencia-wedding', 'quotes']
		},
		{
			id: 'sofia-mateo',
			name: 'Mateo Serra',
			role: 'venue manager',
			organization: 'Valencia event venue',
			language: 'es',
			relationship: 'Controls loading-door access and setup slots for the large wedding.',
			intentKeys: ['valencia-wedding']
		},
		{
			id: 'sofia-elena',
			name: 'Elena Soler',
			role: 'business lawyer',
			organization: 'Soler Legal',
			language: 'es',
			relationship: 'Reviews event cancellation terms, supplier liability and staff agreements.',
			intentKeys: ['quotes', 'staff', 'valencia-wedding']
		},
		{
			id: 'sofia-vera',
			name: 'Vera Martín',
			role: 'payment support employee',
			organization: 'Stripe',
			language: 'es',
			relationship: 'Investigates card deposit disputes and payout timing with case references.',
			intentKeys: ['quotes', 'home-budget']
		},
		{
			id: 'sofia-rafael',
			name: 'Rafael Gómez',
			role: 'rail support employee',
			organization: 'Renfe',
			language: 'es',
			relationship: 'Handles altered family tickets and voucher terms in written support replies.',
			intentKeys: ['porto-visit']
		},
		{
			id: 'sofia-ines',
			name: 'Inés Navarro',
			role: 'friend and running partner',
			organization: null,
			language: 'es',
			relationship:
				'Shares training routes but knows Sofía cannot run long on peak delivery Sundays.',
			intentKeys: ['running', 'porto-visit']
		},
		{
			id: 'sofia-oliver',
			name: 'Oliver Kent',
			role: 'export support employee',
			organization: 'Mar Azul export desk',
			language: 'en',
			relationship:
				'Writes English substitution and shipment handoff emails that Sofía files with Spanish purchase records.',
			intentKeys: ['flower-supplier', 'cold-room']
		},
		{
			id: 'sofia-beatriz',
			name: 'Beatriz Almeida',
			role: 'family host',
			organization: null,
			language: 'pt',
			relationship:
				'Lives in Oporto and often sends Portuguese booking and travel details to Sofía.',
			intentKeys: ['porto-visit', 'school']
		},
		{
			id: 'sofia-tiago',
			name: 'Tiago Costa',
			role: 'rail booking contact',
			organization: 'Portugal rail desk',
			language: 'en',
			relationship: 'Uses English for international booking changes and voucher explanations.',
			intentKeys: ['porto-visit']
		}
	],
	arcs: [
		{
			key: 'valencia-wedding',
			domain: 'business',
			title: 'Boda Valencia y carpeta naranja',
			summary: 'Plan a large wedding delivery with venue access and handoff documents.',
			beats: [
				'confirmar el horario del montaje',
				'revisar la lista de flores',
				'coordinar la puerta de carga',
				'cerrar la hoja de relevo'
			],
			nextAction: 'confirmar el acceso y el relevo con el local',
			doneAt: 154,
			archiveAt: 164
		},
		{
			key: 'cold-room',
			domain: 'business',
			title: 'Cámara fría y mantenimiento',
			summary: 'Keep flowers safe while resolving a recurring refrigeration fault.',
			beats: [
				'revisar la temperatura nocturna',
				'pedir diagnóstico al técnico',
				'separar las flores delicadas',
				'comprobar el registro del compresor'
			],
			nextAction: 'esperar el recambio y comprobar la temperatura',
			waitFrom: 143,
			waitFor: 'el relé R-9 que trae Alba'
		},
		{
			key: 'flower-supplier',
			domain: 'business',
			title: 'Proveedor de flores Mar Azul',
			summary: 'Track imported flowers, delivery slots, and substitutions.',
			beats: [
				'comparar los tallos recibidos',
				'confirmar el pedido de peonías',
				'revisar la factura del proveedor',
				'asegurar el horario de descarga'
			],
			nextAction: 'cerrar la sustitución y guardar la referencia de envío'
		},
		{
			key: 'staff',
			domain: 'business',
			title: 'Turnos del equipo de eventos',
			summary: 'Schedule seasonal florists and make sure event handoffs are clear.',
			beats: [
				'cuadrar el sábado de Lucía',
				'revisar las horas de Mario',
				'preparar el turno de montaje',
				'confirmar las horas extra'
			],
			nextAction: 'publicar el turno confirmado con el equipo'
		},
		{
			key: 'quotes',
			domain: 'business',
			title: 'Presupuestos y anticipos de bodas',
			summary: 'Manage quotes, deposits, and changed client plans.',
			beats: [
				'revisar el anticipo pendiente',
				'ajustar la propuesta floral',
				'comparar costes de transporte',
				'enviar el presupuesto corregido'
			],
			nextAction: 'confirmar la cifra vigente antes de facturar'
		},
		{
			key: 'school',
			domain: 'personal',
			title: 'Colegio y calendario de Nico',
			summary: 'Coordinate Nico’s school events across two households.',
			beats: [
				'revisar la excursión de Nico',
				'confirmar la recogida del jueves',
				'preparar el permiso escolar',
				'avisar al otro hogar del horario'
			],
			nextAction: 'confirmar el horario con Nico y el colegio'
		},
		{
			key: 'running',
			domain: 'personal',
			title: 'Media maratón y entrenamiento',
			summary: 'Train consistently without clashing with delivery weekends.',
			beats: [
				'ajustar la tirada larga',
				'revisar el descanso tras el evento',
				'planificar la ruta del parque',
				'comprobar las zapatillas'
			],
			nextAction: 'mantener una sesión que encaje con las entregas'
		},
		{
			key: 'mother-clinic',
			domain: 'personal',
			title: 'Citas médicas de mamá',
			summary: 'Coordinate accessible transport and appointment changes for her mother.',
			beats: [
				'confirmar el transporte a la clínica',
				'guardar la lista de preguntas',
				'revisar el cambio de hora',
				'avisar a mamá de la entrada correcta'
			],
			nextAction: 'confirmar la cita vigente y el trayecto'
		},
		{
			key: 'home-budget',
			domain: 'personal',
			title: 'Presupuesto del hogar y colegio',
			summary: 'Balance school costs, household bills, and travel.',
			beats: [
				'revisar los gastos del colegio',
				'separar los recibos del hogar',
				'actualizar la reserva de verano',
				'comparar el gasto de transporte'
			],
			nextAction: 'cuadrar los recibos con la cuenta compartida'
		},
		{
			key: 'porto-visit',
			domain: 'personal',
			title: 'Visita familiar a Oporto',
			summary: 'Plan a family trip around school and peak event season.',
			beats: [
				'comparar billetes de tren',
				'confirmar alojamiento familiar',
				'coordinar los días de Nico',
				'preparar la vuelta antes de la boda'
			],
			nextAction: 'cerrar las fechas sin mover las entregas',
			doneAt: 158,
			archiveAt: 168
		}
	],
	anchors: [
		{
			day: 23,
			arc: 'valencia-wedding',
			kind: 'decision',
			user: 'La clave de entrega acordada para la carpeta naranja de Valencia es SOL-983. Va con la hoja de relevo.',
			assistant: 'Guardo SOL-983 como clave de entrega de la carpeta naranja.'
		},
		{
			day: 48,
			arc: 'quotes',
			kind: 'decision',
			user: 'El anticipo estándar para las bodas será del 12 por ciento durante la primavera.',
			assistant: 'Queda registrado el 12 por ciento como anticipo anterior.'
		},
		{
			day: 121,
			arc: 'quotes',
			kind: 'correction',
			user: 'El nuevo anticipo confirmado es del 15 por ciento; sustituye el 12 por ciento antiguo.',
			assistant: 'Para presupuestos nuevos usaré el 15 por ciento, no el 12 por ciento anterior.'
		},
		{
			day: 67,
			arc: 'flower-supplier',
			kind: 'decision',
			user: 'The supplier wrote in English: The shipment handoff reference is ORANGE-64. Keep it with the peony substitution.',
			assistant: 'He guardado ORANGE-64 junto a la sustitución de peonías.'
		},
		{
			day: 145,
			arc: 'cold-room',
			kind: 'blocker',
			user: 'La cámara fría sigue parada: falta el relé R-9 que trae Alba. No volvemos a guardar flores delicadas hasta cambiarlo.',
			assistant: 'El bloqueo actual es el relé R-9 pendiente de Alba; la cámara queda en espera.'
		},
		{
			day: 82,
			arc: 'mother-clinic',
			kind: 'decision',
			user: 'La cita de mamá estaba prevista para el martes a las 18:30.',
			assistant: 'Anoto martes a las 18:30 como horario anterior.'
		},
		{
			day: 132,
			arc: 'mother-clinic',
			kind: 'correction',
			user: 'La clínica cambió la cita de mamá al jueves a las 19:00; el martes a las 18:30 ya no vale.',
			assistant: 'La hora vigente es jueves a las 19:00 y sustituye la del martes.'
		}
	],
	artifactAnchors: [
		{
			day: 23,
			arc: 'valencia-wedding',
			id: 'sofia-orange-handoff',
			kind: 'document',
			language: 'es',
			title: 'Carpeta naranja: hoja de relevo',
			from: 'Estudio Morales',
			to: null,
			body: 'Boda Valencia. Clave de entrega SOL-983. La puerta de carga se confirma con el local; guardar esta hoja con el albarán.'
		},
		{
			day: 48,
			arc: 'quotes',
			id: 'sofia-deposit-spring',
			kind: 'document',
			language: 'es',
			title: 'Plantilla de presupuestos de primavera',
			from: 'Estudio Morales',
			to: null,
			body: 'Anticipo estándar para bodas: 12 por ciento. Revisar esta cifra al actualizar las condiciones.'
		},
		{
			day: 67,
			arc: 'flower-supplier',
			id: 'sofia-orange-shipment-mail',
			kind: 'email',
			language: 'en',
			title: 'Peony substitution handoff',
			from: 'Mar Azul export desk',
			to: 'Sofía Morales',
			body: 'The shipment handoff reference is ORANGE-64. Please include it with the peony substitution and unloading slip.'
		},
		{
			day: 121,
			arc: 'quotes',
			id: 'sofia-deposit-current',
			kind: 'document',
			language: 'es',
			title: 'Condiciones de anticipos vigentes',
			from: 'Estudio Morales',
			to: null,
			body: 'Anticipo confirmado para presupuestos nuevos: 15 por ciento. Sustituye la plantilla anterior del 12 por ciento.',
			supersedesId: 'sofia-deposit-spring'
		},
		{
			day: 132,
			arc: 'mother-clinic',
			id: 'sofia-clinic-updated-mail',
			kind: 'email',
			language: 'es',
			title: 'Cambio de cita de mamá',
			from: 'Clínica Valencia',
			to: 'Sofía Morales',
			body: 'Confirmamos la nueva cita para el jueves a las 19:00. La cita antigua del martes a las 18:30 queda cancelada.'
		},
		{
			day: 145,
			arc: 'cold-room',
			id: 'sofia-cold-room-service-note',
			kind: 'document',
			language: 'es',
			title: 'Parte de mantenimiento de cámara fría',
			from: 'Taller Alba',
			to: null,
			body: 'Cámara fuera de servicio. Falta el relé R-9 que trae Alba. No almacenar flores delicadas hasta instalarlo y comprobar temperatura.'
		}
	],
	probes: [
		{
			id: 'sofia-wedding-key',
			personaId: 'sofia-morales',
			language: 'es',
			question: '¿Cuál era la clave de entrega de la carpeta naranja?',
			arc: 'valencia-wedding',
			expectedAnswer: 'SOL-983',
			answerMode: 'historical',
			anchorDay: 23
		},
		{
			id: 'sofia-current-deposit',
			personaId: 'sofia-morales',
			language: 'es',
			question: '¿Qué anticipo usamos ahora, después del cambio?',
			arc: 'quotes',
			expectedAnswer: '15 por ciento',
			answerMode: 'latest-correction',
			anchorDay: 121
		},
		{
			id: 'sofia-cold-room-blocker',
			personaId: 'sofia-morales',
			language: 'es',
			question: '¿Qué falta para volver a usar la cámara fría?',
			arc: 'cold-room',
			expectedAnswer: 'R-9',
			answerMode: 'current-blocker',
			anchorDay: 145
		},
		{
			id: 'sofia-english-shipment',
			personaId: 'sofia-morales',
			language: 'es',
			question: '¿Cuál era la referencia de relevo del envío en el correo inglés?',
			arc: 'flower-supplier',
			expectedAnswer: 'ORANGE-64',
			answerMode: 'cross-language',
			anchorDay: 67,
			targetArtifactId: 'sofia-orange-shipment-mail'
		},
		{
			id: 'sofia-orange-document',
			personaId: 'sofia-morales',
			language: 'es',
			question: 'Busca la hoja de relevo antigua de la carpeta naranja. ¿Qué clave indica?',
			arc: 'valencia-wedding',
			expectedAnswer: 'SOL-983',
			answerMode: 'historical',
			anchorDay: 23,
			targetArtifactId: 'sofia-orange-handoff'
		},
		{
			id: 'sofia-current-clinic-time',
			personaId: 'sofia-morales',
			language: 'es',
			question: '¿Cuándo es ahora la cita de mamá?',
			arc: 'mother-clinic',
			expectedAnswer: 'jueves a las 19:00',
			answerMode: 'latest-correction',
			anchorDay: 132
		}
	],
	oneOffs: {
		personal: [
			'recoger un paquete de Nico',
			'renovar zapatillas',
			'reservar tren a Oporto',
			'buscar permiso escolar',
			'revisar factura de luz',
			'comprar regalo de cumpleaños',
			'pedir cita de dentista',
			'organizar comida familiar',
			'llevar libros al colegio',
			'cambiar una bombilla'
		],
		business: [
			'revisar factura de flores',
			'responder a una novia',
			'pedir cinta para ramos',
			'confirmar furgoneta',
			'fotografiar montaje',
			'revisar horas del equipo',
			'guardar albarán',
			'enviar presupuesto',
			'reservar jarrones',
			'llamar al técnico'
		]
	},
	phrases: {
		checkIn: (title, beat, date) =>
			`Para ${title} el ${date}: ${beat}. ¿Cuál es el siguiente paso?`,
		reply: (nextAction, state, date) =>
			`A ${date}: ${state === 'waiting' ? 'Seguimos en espera.' : 'Podemos avanzar.'} Lo siguiente es ${nextAction}.`,
		oneOff: (title, date) => `Para el ${date}, necesito ${title} y guardar el comprobante.`,
		oneOffReply: (title) => `He abierto una tarea separada para ${title} y guardado los detalles.`,
		followUp: (title, date) => `¿Quedó listo ${title} el ${date}?`,
		followUpReply: (title) => `${title} quedó cerrado con el último comprobante y puede archivarse.`
	}
}

const rowan: PersonaConfig = {
	profile: {
		id: 'rowan-chen',
		name: 'Rowan Chen',
		language: 'en',
		city: 'Bristol',
		personalLife:
			'Renovates a kitchen with their partner, volunteers at a community garden, and shares care for a foster dog.',
		businessLife:
			'Runs a small data consultancy serving retail and nonprofit clients while hiring a contractor.',
		household:
			'Shares a Bristol home with partner Ellis; kitchen work is paid from a protected reserve. They foster dog Pip and volunteer at a community garden; Glasgow family trips require dog cover.',
		businessOperations:
			'Consultancy bills Atlas and nonprofit clients by bank transfer, uses a company Mastercard for travel and software, keeps HMRC VAT records, and cannot exchange production data until a signed DPA is in place.',
		paymentMethods: [
			'fictional company Mastercard ending 3074',
			'Monzo household debit ending 5526',
			'PayPal for small online orders',
			'UK bank transfer'
		],
		providers: [
			'GWR',
			'National Rail',
			'Royal Mail',
			'PayPal',
			'Monzo',
			'HMRC',
			'Atlas',
			'Bristol contractors'
		],
		recurringObligations: [
			'software subscriptions',
			'contractor invoices',
			'VAT and tax reserve',
			'renovation instalments',
			'foster dog supplies',
			'rail travel and client expenses'
		],
		writingStyle:
			'Rowan writes concise British English with brief bullet-like questions and dry humour at home. Client and security messages are exact about versions and access; occasional shorthand appears in internal notes.'
	},
	contacts: [
		{
			id: 'rowan-ellis',
			name: 'Ellis Chen',
			role: 'partner',
			organization: null,
			language: 'en',
			relationship:
				'Shares kitchen decisions and household spending; protects the renovation reserve.',
			intentKeys: ['kitchen', 'household', 'family-visit']
		},
		{
			id: 'rowan-jo',
			name: 'Jo Harding',
			role: 'foster coordinator',
			organization: 'Bristol foster group',
			language: 'en',
			relationship: "Coordinates Pip's vet advice, weekend care and handoff consent.",
			intentKeys: ['foster-dog', 'family-visit']
		},
		{
			id: 'rowan-jamie',
			name: 'Jamie Chen',
			role: 'sibling',
			organization: null,
			language: 'en',
			relationship: 'Lives in Glasgow and hosts family visits; train times must fit dog cover.',
			intentKeys: ['family-visit']
		},
		{
			id: 'rowan-priya',
			name: 'Priya Shah',
			role: 'client project lead',
			organization: 'Atlas',
			language: 'en',
			relationship: 'Confirms signed renewal terms and challenges rebate calculations.',
			intentKeys: ['atlas-contract', 'invoices']
		},
		{
			id: 'rowan-malik',
			name: 'Malik Ahmed',
			role: 'client lawyer',
			organization: 'Atlas legal',
			language: 'en',
			relationship:
				'Countersigns DPA-42 and renewal appendices; drafts are not enough to release production data.',
			intentKeys: ['security-audit', 'atlas-contract']
		},
		{
			id: 'rowan-sam',
			name: 'Sam Patel',
			role: 'contractor candidate',
			organization: null,
			language: 'en',
			relationship:
				'Needs a clear first assignment and access only after agreement and references.',
			intentKeys: ['contractor', 'migration']
		},
		{
			id: 'rowan-tess',
			name: 'Tess Morgan',
			role: 'kitchen builder',
			organization: 'Morgan Joinery',
			language: 'en',
			relationship:
				'Schedules cabinet delivery and staged payments; measurements must match before fitting.',
			intentKeys: ['kitchen', 'household']
		},
		{
			id: 'rowan-hazel',
			name: 'Hazel Reed',
			role: 'retailer support employee',
			organization: 'Kitchen supplier',
			language: 'en',
			relationship: 'Handles delivery faults, returns and refund evidence for renovation items.',
			intentKeys: ['kitchen', 'household']
		},
		{
			id: 'rowan-dani',
			name: 'Dani Brooks',
			role: 'rail support employee',
			organization: 'GWR',
			language: 'en',
			relationship: 'Handles revised eTickets and delay claims with booking references.',
			intentKeys: ['family-visit', 'invoices']
		},
		{
			id: 'rowan-lee',
			name: 'Lee Carter',
			role: 'bank support employee',
			organization: 'Monzo',
			language: 'en',
			relationship:
				'Reviews card transaction disputes and pending reversals without exposing full account details.',
			intentKeys: ['household', 'invoices']
		},
		{
			id: 'rowan-asha',
			name: 'Asha Green',
			role: 'garden volunteer',
			organization: 'Community garden',
			language: 'en',
			relationship: 'Opens the shed and hands tools to the closing shift.',
			intentKeys: ['garden']
		},
		{
			id: 'rowan-mary',
			name: 'Mary Evans',
			role: 'nonprofit client lead',
			organization: 'Bristol nonprofit',
			language: 'en',
			relationship: 'Wants clear migration dates, bounded access, and explainable invoices.',
			intentKeys: ['migration', 'security-audit', 'invoices']
		},
		{
			id: 'rowan-bea',
			name: 'Bea Fox',
			role: 'friend',
			organization: null,
			language: 'en',
			relationship:
				'Can dog-sit occasionally, but needs advance notice and foster coordinator approval.',
			intentKeys: ['foster-dog', 'family-visit']
		},
		{
			id: 'rowan-lucia',
			name: 'Lucía Ortega',
			role: 'migration partner analyst',
			organization: 'Iberia retail partner',
			language: 'es',
			relationship:
				'Writes Spanish handoff notes for test batches; Rowan replies in English and keeps the reference with dry-run evidence.',
			intentKeys: ['migration', 'security-audit']
		},
		{
			id: 'rowan-pablo',
			name: 'Pablo Ruiz',
			role: 'supplier support employee',
			organization: 'Iberia retail partner',
			language: 'es',
			relationship: 'Replies in Spanish about delayed source exports and data-field questions.',
			intentKeys: ['migration']
		}
	],
	arcs: [
		{
			key: 'atlas-contract',
			domain: 'business',
			title: 'Atlas client renewal and rebate',
			summary: 'Track changing rebate terms and signed renewal documents.',
			beats: [
				'review the renewal draft',
				'compare the rebate schedule',
				'check the signed appendix',
				'confirm the billing start date'
			],
			nextAction: 'use the most recently signed rebate term'
		},
		{
			key: 'security-audit',
			domain: 'business',
			title: 'Client security audit and DPA',
			summary: 'Complete a security review before exchanging production data.',
			beats: [
				'review access evidence',
				'check the processor list',
				'ask legal about the DPA',
				'prepare the audit response'
			],
			nextAction: 'wait for the signed DPA before moving data',
			waitFrom: 147,
			waitFor: 'signed DPA-42'
		},
		{
			key: 'migration',
			domain: 'business',
			title: 'Retail data migration',
			summary: 'Stage a retail data migration while validating source files.',
			beats: [
				'compare source row counts',
				'check the dry-run errors',
				'review the cutover window',
				'confirm the rollback snapshot'
			],
			nextAction: 'run the next validation before cutover'
		},
		{
			key: 'contractor',
			domain: 'business',
			title: 'Contractor onboarding',
			summary: 'Hire a contractor with bounded access and a clear first project.',
			beats: [
				'review the shortlist',
				'clarify the first assignment',
				'check references',
				'prepare access after agreement'
			],
			nextAction: 'finish the agreement before granting access'
		},
		{
			key: 'invoices',
			domain: 'business',
			title: 'Consultancy invoices and cashflow',
			summary: 'Reconcile client invoices, tax reserves, and overdue work.',
			beats: [
				'match a payment to an invoice',
				'review the tax reserve',
				'follow up an overdue bill',
				'check the monthly forecast'
			],
			nextAction: 'reconcile the latest bank evidence'
		},
		{
			key: 'kitchen',
			domain: 'personal',
			title: 'Kitchen renovation and paint',
			summary: 'Manage the renovation schedule, materials, and finish choices.',
			beats: [
				'compare cabinet lead times',
				'review the wall finish',
				'ask the electrician for a date',
				'check the delivery measurements'
			],
			nextAction: 'confirm the next trade visit and material order'
		},
		{
			key: 'foster-dog',
			domain: 'personal',
			title: 'Foster dog care and walks',
			summary: 'Coordinate feeding, walks, and the foster dog’s vet visits.',
			beats: [
				'check the walking rota',
				'note the vet advice',
				'compare food supplies',
				'arrange weekend care'
			],
			nextAction: 'share the current care plan with the foster group'
		},
		{
			key: 'garden',
			domain: 'personal',
			title: 'Community garden volunteer rota',
			summary: 'Organize volunteer shifts and equipment without losing handoff notes.',
			beats: [
				'check the Saturday rota',
				'count spare tools',
				'plan the seedling handoff',
				'confirm the shed key'
			],
			nextAction: 'confirm who opens the shed',
			doneAt: 154,
			archiveAt: 164
		},
		{
			key: 'family-visit',
			domain: 'personal',
			title: 'Family visit in Glasgow',
			summary: 'Plan travel around client work and the dog’s care.',
			beats: [
				'compare train departures',
				'arrange dog cover',
				'check the family dinner',
				'confirm the return date'
			],
			nextAction: 'close the travel plan with the family',
			doneAt: 157,
			archiveAt: 167
		},
		{
			key: 'household',
			domain: 'personal',
			title: 'Household bills and renovation reserve',
			summary: 'Protect the household reserve through renovation spending.',
			beats: [
				'review a utility bill',
				'compare the builder invoice',
				'recheck the reserve',
				'plan the next deposit'
			],
			nextAction: 'update the shared budget with actual receipts'
		}
	],
	anchors: [
		{
			day: 12,
			arc: 'atlas-contract',
			kind: 'decision',
			user: 'The 2025 Atlas rebate was 4 percent. Keep that as the old term until the renewal is signed.',
			assistant: 'I recorded 4 percent as the old Atlas rebate, pending a newer agreement.'
		},
		{
			day: 122,
			arc: 'atlas-contract',
			kind: 'correction',
			user: 'The signed 2026 Atlas renewal sets the rebate at 7 percent and supersedes the old 4 percent figure.',
			assistant:
				'The current Atlas rebate is 7 percent; 4 percent belongs only to the superseded 2025 agreement.'
		},
		{
			day: 43,
			arc: 'kitchen',
			kind: 'decision',
			user: 'We chose the kitchen wall colour SALT-312, a warm off-white. Keep that code with the paint order.',
			assistant: 'SALT-312 is the selected kitchen wall colour and is attached to the paint order.'
		},
		{
			day: 149,
			arc: 'security-audit',
			kind: 'blocker',
			user: 'The client security audit is blocked on the signed DPA-42. No production data transfer before that document is countersigned.',
			assistant: 'The current blocker is signed DPA-42; production transfer stays paused.'
		},
		{
			day: 70,
			arc: 'migration',
			kind: 'decision',
			user: 'The partner emailed in Spanish: La referencia de envío para el lote de prueba es RIO-588. Keep it with the migration dry run.',
			assistant: 'I saved RIO-588 as the test-batch handoff reference for the migration.'
		},
		{
			day: 58,
			arc: 'garden',
			kind: 'decision',
			user: 'The community garden shed locker label is GREEN-806. Volunteers need it for the Saturday tool handoff.',
			assistant: 'GREEN-806 is the shed locker label for the volunteer handoff.'
		}
	],
	artifactAnchors: [
		{
			day: 12,
			arc: 'atlas-contract',
			id: 'rowan-atlas-2025',
			kind: 'document',
			language: 'en',
			title: 'Atlas 2025 rebate appendix',
			from: 'Atlas contracts',
			to: null,
			body: 'The 2025 rebate is 4 percent. This appendix remains historical once a signed 2026 renewal supersedes it.'
		},
		{
			day: 43,
			arc: 'kitchen',
			id: 'rowan-paint-order',
			kind: 'email',
			language: 'en',
			title: 'Kitchen wall paint order',
			from: 'Rowan Chen',
			to: 'Paint supplier',
			body: 'Please prepare the warm off-white kitchen wall colour SALT-312. Confirm the sample before dispatch.'
		},
		{
			day: 58,
			arc: 'garden',
			id: 'rowan-garden-rota',
			kind: 'document',
			language: 'en',
			title: 'Saturday garden tool handoff',
			from: 'Community garden',
			to: null,
			body: 'Shed locker label GREEN-806. The opening volunteer checks the tool count and passes the key to the closing shift.'
		},
		{
			day: 70,
			arc: 'migration',
			id: 'rowan-spanish-batch-mail',
			kind: 'email',
			language: 'es',
			title: 'Referencia del lote de prueba',
			from: 'Socio de migración',
			to: 'Rowan Chen',
			body: 'La referencia de envío para el lote de prueba es RIO-588. Guárdala junto con el ensayo de migración.'
		},
		{
			day: 122,
			arc: 'atlas-contract',
			id: 'rowan-atlas-2026',
			kind: 'document',
			language: 'en',
			title: 'Signed Atlas 2026 renewal',
			from: 'Atlas contracts',
			to: null,
			body: 'The signed 2026 renewal sets the current rebate at 7 percent. It supersedes the 2025 appendix with its 4 percent rebate.',
			supersedesId: 'rowan-atlas-2025'
		},
		{
			day: 149,
			arc: 'security-audit',
			id: 'rowan-audit-evidence',
			kind: 'email',
			language: 'en',
			title: 'Security audit evidence still pending',
			from: 'Client security team',
			to: 'Rowan Chen',
			body: 'Production data transfer remains blocked until DPA-42 is signed and countersigned. Please leave the audit open.'
		}
	],
	probes: [
		{
			id: 'rowan-current-atlas-rebate',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'What Atlas rebate is current after the renewal changed the old figure?',
			arc: 'atlas-contract',
			expectedAnswer: '7 percent',
			answerMode: 'latest-correction',
			anchorDay: 122
		},
		{
			id: 'rowan-kitchen-paint',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'What code did we choose for the kitchen wall paint months ago?',
			arc: 'kitchen',
			expectedAnswer: 'SALT-312',
			answerMode: 'historical',
			anchorDay: 43
		},
		{
			id: 'rowan-audit-blocker',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'What is still blocking the security audit?',
			arc: 'security-audit',
			expectedAnswer: 'DPA-42',
			answerMode: 'current-blocker',
			anchorDay: 149
		},
		{
			id: 'rowan-spanish-reference',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'What test-batch handoff reference was in the Spanish partner email?',
			arc: 'migration',
			expectedAnswer: 'RIO-588',
			answerMode: 'cross-language',
			anchorDay: 70,
			targetArtifactId: 'rowan-spanish-batch-mail'
		},
		{
			id: 'rowan-signed-renewal-document',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'Find the signed Atlas renewal document. Which rebate superseded the old appendix?',
			arc: 'atlas-contract',
			expectedAnswer: '7 percent',
			answerMode: 'latest-correction',
			anchorDay: 122,
			targetArtifactId: 'rowan-atlas-2026'
		},
		{
			id: 'rowan-garden-locker',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'What was the locker label in the old garden volunteer thread?',
			arc: 'garden',
			expectedAnswer: 'GREEN-806',
			answerMode: 'historical',
			anchorDay: 58
		},
		{
			id: 'rowan-missing-pin',
			personaId: 'rowan-chen',
			language: 'en',
			question: 'What emergency vault PIN did we decide on?',
			arc: null,
			expectedAnswer: null,
			answerMode: 'not-found',
			anchorDay: null
		}
	],
	oneOffs: {
		personal: [
			'collect a parcel',
			'replace a bicycle light',
			'book a train ticket',
			'check a builder receipt',
			'buy dog food',
			'schedule a vet call',
			'confirm a family dinner',
			'sort spare paint',
			'borrow garden tools',
			'return a library book'
		],
		business: [
			'match an invoice receipt',
			'reply to a client question',
			'review a test CSV',
			'book a contractor interview',
			'check a security form',
			'confirm a cutover call',
			'send a draft proposal',
			'review a timesheet',
			'file a travel expense',
			'schedule a demo'
		]
	},
	phrases: {
		checkIn: (title, beat, date) => `For ${title} on ${date}: ${beat}. What should happen next?`,
		reply: (nextAction, state, date) =>
			`As of ${date}, ${state === 'waiting' ? 'this remains on hold' : 'work can continue'}. Next, ${nextAction}.`,
		oneOff: (title, date) => `For ${date}, please ${title} and keep the evidence together.`,
		oneOffReply: (title) => `I opened ${title} as its own matter and recorded the next details.`,
		followUp: (title, date) => `Was ${title} completed by ${date}, or is anything missing?`,
		followUpReply: (title) => `${title} is complete with the last receipt and can be archived.`
	}
}

const configs = [lena, sofia, rowan]

function contactWritingStyle(role: string): string {
	if (role.includes('lawyer'))
		return 'Formal and precise: names parties, version and signature state; avoids chat shorthand.'
	if (role.includes('support employee'))
		return 'Polite, somewhat scripted replies with a case reference, status and specific next step; may repeat a company phrase.'
	if (role.includes('supplier') || role.includes('technician'))
		return 'Practical and concise, with item names, dates and operational caveats rather than warm small talk.'
	if (role.includes('friend') || role.includes('running partner'))
		return 'Relaxed messages with occasional slang, omissions and small spelling slips; still clear about plans.'
	if (
		role.includes('partner') ||
		role.includes('parent') ||
		role.includes('sibling') ||
		role.includes('child')
	)
		return 'Casual family chat, short fragments and familiar references; occasionally leaves details implicit.'
	if (role.includes('customer') || role.includes('client'))
		return 'Polite but personal, becoming direct when delivery, cost or timing is unclear.'
	if (role.includes('instructor') || role.includes('florist') || role.includes('volunteer'))
		return 'Quick practical notes, abbreviations and shift details; not every sentence is complete.'
	return 'Plain conversational writing shaped by this role; keeps important dates and amounts legible.'
}

function dateAt(dayIndex: number): string {
	const date = new Date(`${CORPUS_START}T12:00:00Z`)
	date.setUTCDate(date.getUTCDate() + dayIndex)
	return date.toISOString().slice(0, 10)
}

function stateAt(arc: Arc, dayIndex: number): CorpusStatus {
	if (arc.archiveAt !== undefined && dayIndex >= arc.archiveAt) return 'archive'
	if (arc.doneAt !== undefined && dayIndex >= arc.doneAt) return 'done'
	if (
		arc.waitFrom !== undefined &&
		dayIndex >= arc.waitFrom &&
		(arc.resolvedAt === undefined || dayIndex < arc.resolvedAt)
	)
		return 'waiting'
	return 'working'
}

function routineConversation(
	language: CorpusLanguage,
	title: string,
	beat: string,
	nextAction: string,
	state: CorpusStatus,
	dayIndex: number,
	slot: number
): { user: string; assistant: string } {
	const variant = (dayIndex * 3 + slot * 5) % 8
	const pending = state === 'waiting'
	if (language === 'de') {
		const user = [
			`Bei ${title}: ${beat}. Was ist jetzt dran?`,
			`${beat} — kannst du das bei ${title} festhalten?`,
			`Kurzes Update zu ${title}: ${beat}.`,
			`Ich hab ${title} noch auf dem Zettel. ${beat}; wo hängen wir?`,
			`${title}: ${beat}. Bitte den Stand prüfen.`,
			`Heute ${beat}. Ist bei ${title} noch was offen?`,
			`Wegen ${title}, ${beat}. Den nächsten Schritt bitte merken.`,
			`${beat}. Wie geht's bei ${title} weiter?`
		][variant]
		const assistant = pending
			? [
					`Ich lasse die Sache offen. Sobald die fehlende Rückmeldung da ist, kann ${nextAction}.`,
					`Noch kein Abschluss: Die Abhängigkeit ist offen. Danach: ${nextAction}.`,
					`Das bleibt vorerst liegen. Nächster Schritt nach der Freigabe: ${nextAction}.`,
					`Ich halte den Stand als wartend fest; ${nextAction} erst nach Klärung.`
				][variant % 4]
			: [
					`Erfasst. Als Nächstes ${nextAction}.`,
					`Das ist im Vorgang. Ich würde jetzt ${nextAction}.`,
					`Okay, ${beat} ist notiert. Dann ${nextAction}.`,
					`Der Punkt ist offen für die nächste Runde: ${nextAction}.`
				][variant % 4]
		return { user, assistant }
	}
	if (language === 'es') {
		const user = [
			`Sobre ${title}: ${beat}. ¿Qué toca ahora?`,
			`${beat}; ¿lo dejamos apuntado en ${title}?`,
			`Actualización rápida de ${title}: ${beat}.`,
			`Tengo ${title} pendiente. ${beat}; ¿cómo vamos?`,
			`${title}: ${beat}. Revisa el estado, porfa.`,
			`Hoy ${beat}. ¿Queda algo por cerrar en ${title}?`,
			`Por ${title}, ${beat}. Recuérdame el siguiente paso.`,
			`${beat}. ¿Qué sigue en ${title}?`
		][variant]
		const assistant = pending
			? [
					`Lo dejo abierto hasta que llegue la respuesta pendiente. Después, ${nextAction}.`,
					`Aún no está cerrado; falta la confirmación. Luego, ${nextAction}.`,
					`Seguimos en espera. El próximo paso será ${nextAction}.`,
					`Anotado como pendiente. No avanzo antes de aclararlo; después, ${nextAction}.`
				][variant % 4]
			: [
					`Apuntado. Ahora toca ${nextAction}.`,
					`Está en el expediente. Yo seguiría con ${nextAction}.`,
					`Vale, queda anotado ${beat}. Después, ${nextAction}.`,
					`Lo dejo preparado para la próxima revisión: ${nextAction}.`
				][variant % 4]
		return { user, assistant }
	}
	const user = [
		`On ${title}: ${beat}. What comes next?`,
		`${beat} — can you keep that with ${title}?`,
		`Quick update on ${title}: ${beat}.`,
		`Still have ${title} on my list. ${beat}; where are we?`,
		`${title}: ${beat}. Please check the status.`,
		`Today, ${beat}. Anything still open on ${title}?`,
		`For ${title}, ${beat}. Remind me of the next step.`,
		`${beat}. How do we move ${title} along?`
	][variant]
	const assistant = pending
		? [
				`I’ll keep it open until the missing response arrives. Then ${nextAction}.`,
				`Not finished yet; the dependency is still open. After that, ${nextAction}.`,
				`This stays on hold for now. Next: ${nextAction}.`,
				`Recorded as waiting. I’ll only ${nextAction} once it is cleared.`
			][variant % 4]
		: [
				`Noted. Next, ${nextAction}.`,
				`It’s in the matter. I’d now ${nextAction}.`,
				`Okay, I recorded ${beat}. Then ${nextAction}.`,
				`I’ll keep this for the next review: ${nextAction}.`
			][variant % 4]
	return { user, assistant }
}

/** Produces the same ordered corpus on every run; no model call or private data. */
export function generatePersonaCorpus(): PersonaCorpus {
	const intents: CorpusIntent[] = []
	const messages: CorpusMessage[] = []
	const artifacts: CorpusArtifact[] = []
	const days: CorpusDay[] = []
	const probes: CorpusProbe[] = []
	let messageSequence = 0
	for (const config of configs) {
		const persona = config.profile
		const byKey = new Map<string, CorpusIntent>()
		const requireIntent = (key: string): CorpusIntent => {
			const intent = byKey.get(key)
			if (!intent) throw new Error(`Missing corpus Intent: ${persona.id}:${key}`)
			return intent
		}
		for (const arc of config.arcs) {
			const intent: CorpusIntent = {
				id: `${persona.id}:${arc.key}`,
				personaId: persona.id,
				domain: arc.domain,
				title: arc.title,
				type: arc.domain === 'business' ? 'project' : 'life',
				source: 'Conversation',
				routingSummary: arc.summary,
				createdAt: CORPUS_START,
				updatedAt: CORPUS_START,
				status: 'working',
				core: true
			}
			intents.push(intent)
			byKey.set(arc.key, intent)
		}
		const personalArcs = config.arcs.filter((arc) => arc.domain === 'personal')
		const businessArcs = config.arcs.filter((arc) => arc.domain === 'business')
		const recent: string[] = []
		const oneOffFollowUps = new Map<number, CorpusIntent[]>()
		const append = (
			intent: CorpusIntent,
			dayIndex: number,
			role: CorpusMessage['role'],
			kind: CorpusMessage['kind'],
			content: string
		) => {
			const date = dateAt(dayIndex)
			messages.push({
				id: `m-${String(++messageSequence).padStart(7, '0')}`,
				personaId: persona.id,
				intentId: intent.id,
				createdAt: `${date}T${role === 'user' ? '09:10' : '09:11'}:00Z`,
				dayIndex,
				role,
				kind,
				content
			})
			intent.updatedAt = date
		}
		for (let dayIndex = 0; dayIndex < CORPUS_DAYS; dayIndex++) {
			const date = dateAt(dayIndex)
			const touched: string[] = []
			const created: string[] = []
			const createdArtifactIds: string[] = []
			const touch = (intent: CorpusIntent) => {
				if (!touched.includes(intent.id)) touched.push(intent.id)
				const previous = recent.indexOf(intent.id)
				if (previous >= 0) recent.splice(previous, 1)
				recent.unshift(intent.id)
				recent.splice(8)
			}
			for (const arcs of [businessArcs, personalArcs]) {
				const availableArcs = arcs.filter(
					(arc) => !['archive', 'done'].includes(stateAt(arc, dayIndex))
				)
				for (let slot = 0; slot < 2; slot++) {
					const arc = availableArcs[(dayIndex * 2 + slot) % availableArcs.length]
					const state = stateAt(arc, dayIndex)
					const intent = requireIntent(arc.key)
					intent.status = state
					const beat = arc.beats[(Math.floor(dayIndex / 7) + slot) % arc.beats.length]
					const conversation = routineConversation(
						persona.language,
						intent.title,
						beat,
						arc.nextAction,
						state,
						dayIndex,
						slot
					)
					append(intent, dayIndex, 'user', 'check-in', conversation.user)
					append(intent, dayIndex, 'assistant', 'check-in', conversation.assistant)
					touch(intent)
				}
			}
			for (const anchor of config.anchors.filter((item) => item.day === dayIndex)) {
				const intent = requireIntent(anchor.arc)
				append(intent, dayIndex, 'user', anchor.kind, anchor.user)
				append(intent, dayIndex, 'assistant', anchor.kind, anchor.assistant)
				touch(intent)
			}
			for (const arc of config.arcs) {
				if (![arc.waitFrom, arc.resolvedAt, arc.doneAt, arc.archiveAt].includes(dayIndex)) continue
				const intent = requireIntent(arc.key)
				const state = stateAt(arc, dayIndex)
				intent.status = state
				if (arc.waitFrom === dayIndex && arc.waitFor) {
					append(
						intent,
						dayIndex,
						'user',
						'blocker',
						`${intent.title}: waiting for ${arc.waitFor}. Keep the next step on hold.`
					)
					append(
						intent,
						dayIndex,
						'assistant',
						'blocker',
						`This intent is waiting on ${arc.waitFor}; I will not mark it done yet.`
					)
				} else if (arc.resolvedAt === dayIndex) {
					append(
						intent,
						dayIndex,
						'user',
						'resolution',
						`${intent.title}: the outstanding evidence arrived; resume work.`
					)
					append(
						intent,
						dayIndex,
						'assistant',
						'resolution',
						`The blocker is resolved and the intent can continue.`
					)
				} else if (arc.doneAt === dayIndex) {
					append(
						intent,
						dayIndex,
						'user',
						'resolution',
						`${intent.title}: the handoff is complete.`
					)
					append(
						intent,
						dayIndex,
						'assistant',
						'resolution',
						`I marked the work done and kept its history.`
					)
				}
				touch(intent)
			}
			if (dayIndex % 2 === 0) {
				const domain: CorpusDomain = dayIndex % 4 === 0 ? 'personal' : 'business'
				const choices = config.oneOffs[domain]
				const title = choices[(dayIndex / 2) % choices.length]
				const intent: CorpusIntent = {
					id: `${persona.id}:one-off-${String(dayIndex).padStart(3, '0')}`,
					personaId: persona.id,
					domain,
					title: `${title} · ${date}`,
					type: 'one-off',
					source: 'Daily note',
					routingSummary: `${domain} one-off from ${date}`,
					createdAt: date,
					updatedAt: date,
					status: 'working',
					core: false
				}
				intents.push(intent)
				created.push(intent.id)
				append(intent, dayIndex, 'user', 'one-off', config.phrases.oneOff(title, date))
				append(intent, dayIndex, 'assistant', 'one-off', config.phrases.oneOffReply(title))
				touch(intent)
				const followDay = Math.min(dayIndex + 3, CORPUS_DAYS - 1)
				oneOffFollowUps.set(followDay, [...(oneOffFollowUps.get(followDay) ?? []), intent])
			}
			for (const intent of oneOffFollowUps.get(dayIndex) ?? []) {
				append(intent, dayIndex, 'user', 'one-off', config.phrases.followUp(intent.title, date))
				append(intent, dayIndex, 'assistant', 'one-off', config.phrases.followUpReply(intent.title))
				intent.status = dayIndex % 3 === 0 ? 'done' : 'archive'
				touch(intent)
			}
			const routineDomain: CorpusDomain = dayIndex % 2 === 0 ? 'business' : 'personal'
			const routineArcs = (routineDomain === 'business' ? businessArcs : personalArcs).filter(
				(arc) => !['archive', 'done'].includes(stateAt(arc, dayIndex))
			)
			const routineArc = routineArcs[dayIndex % routineArcs.length]
			const routineIntent = requireIntent(routineArc.key)
			const routineKind: CorpusArtifact['kind'] = dayIndex % 4 < 2 ? 'email' : 'document'
			const reference = `${persona.id.toUpperCase()}-${String(dayIndex).padStart(3, '0')}`
			const beat = routineArc.beats[dayIndex % routineArc.beats.length]
			const detail =
				persona.language === 'de'
					? `Stand ${date}. Vorgang ${reference}. ${beat}. Nächster Schritt: ${routineArc.nextAction}. Bitte die Unterlagen bei dieser Sache ablegen.`
					: persona.language === 'es'
						? `Estado ${date}. Referencia ${reference}. ${beat}. Siguiente paso: ${routineArc.nextAction}. Guardar el comprobante en esta carpeta.`
						: `Status ${date}. Reference ${reference}. ${beat}. Next step: ${routineArc.nextAction}. Keep the supporting evidence in this matter.`
			const routineArtifact: CorpusArtifact = {
				id: `${persona.id}:artifact-${String(dayIndex).padStart(3, '0')}`,
				personaId: persona.id,
				intentId: routineIntent.id,
				dayIndex,
				createdAt: `${date}T14:00:00Z`,
				kind: routineKind,
				language: persona.language,
				title: `${persona.language === 'de' ? (routineKind === 'email' ? 'Rückfrage' : 'Arbeitsnotiz') : persona.language === 'es' ? (routineKind === 'email' ? 'Seguimiento' : 'Nota de trabajo') : routineKind === 'email' ? 'Follow-up' : 'Working note'}: ${routineIntent.title} · ${date}`,
				from:
					routineKind === 'email'
						? `${persona.name} <synthetic@example.test>`
						: `${persona.name} workspace`,
				to: routineKind === 'email' ? 'colleague <synthetic@example.test>' : null,
				body: detail,
				supersedesId: null
			}
			artifacts.push(routineArtifact)
			createdArtifactIds.push(routineArtifact.id)
			if (dayIndex % 3 === 0) {
				const extraKind: CorpusArtifact['kind'] = ['calendar', 'todo', 'receipt'][
					(dayIndex / 3) % 3
				] as CorpusArtifact['kind']
				const amount = 12 + (dayIndex % 17) * 3
				const extraBody =
					persona.language === 'de'
						? extraKind === 'calendar'
							? `Termin ${date}, 16:30 Uhr: ${routineIntent.title}. Vorgang ${reference}; ${beat}.`
							: extraKind === 'todo'
								? `Offen für ${routineIntent.title}: ${beat}. Fällig am ${date}. Vorgang ${reference}.`
								: `Beleg ${reference} vom ${date}: ${amount},00 Euro für ${routineIntent.title}. Mit dem Vorgang abgleichen.`
						: persona.language === 'es'
							? extraKind === 'calendar'
								? `Cita ${date}, 16:30: ${routineIntent.title}. Referencia ${reference}; ${beat}.`
								: extraKind === 'todo'
									? `Pendiente para ${routineIntent.title}: ${beat}. Vence el ${date}. Referencia ${reference}.`
									: `Recibo ${reference} del ${date}: ${amount},00 euros para ${routineIntent.title}. Conciliar con el expediente.`
							: extraKind === 'calendar'
								? `Appointment ${date}, 16:30: ${routineIntent.title}. Reference ${reference}; ${beat}.`
								: extraKind === 'todo'
									? `Open item for ${routineIntent.title}: ${beat}. Due ${date}. Reference ${reference}.`
									: `Receipt ${reference} dated ${date}: ${amount}.00 GBP for ${routineIntent.title}. Reconcile with the matter.`
				const extraArtifact: CorpusArtifact = {
					id: `${persona.id}:extra-${String(dayIndex).padStart(3, '0')}`,
					personaId: persona.id,
					intentId: routineIntent.id,
					dayIndex,
					createdAt: `${date}T17:00:00Z`,
					kind: extraKind,
					language: persona.language,
					title: `${extraKind.toUpperCase()}: ${routineIntent.title} · ${date}`,
					from: `${persona.name} workspace`,
					to: null,
					body: extraBody,
					supersedesId: null
				}
				artifacts.push(extraArtifact)
				createdArtifactIds.push(extraArtifact.id)
			}
			for (const anchor of config.artifactAnchors.filter((item) => item.day === dayIndex)) {
				const anchorArtifact: CorpusArtifact = {
					id: anchor.id,
					personaId: persona.id,
					intentId: requireIntent(anchor.arc).id,
					dayIndex,
					createdAt: `${date}T15:00:00Z`,
					kind: anchor.kind,
					language: anchor.language,
					title: anchor.title,
					from: anchor.from,
					to: anchor.to,
					body: anchor.body,
					supersedesId: anchor.supersedesId ?? null
				}
				artifacts.push(anchorArtifact)
				createdArtifactIds.push(anchorArtifact.id)
			}
			const ownIntents = intents.filter((intent) => intent.personaId === persona.id)
			days.push({
				personaId: persona.id,
				date,
				dayIndex,
				selectedIntentId: recent[0],
				recentIntentIds: [...recent],
				createdIntentIds: created,
				touchedIntentIds: touched,
				createdArtifactIds,
				activeCount: ownIntents.filter(
					(intent) => intent.status !== 'archive' && intent.status !== 'done'
				).length,
				waitingCount: ownIntents.filter((intent) => intent.status === 'waiting').length
			})
		}
		for (const arc of config.arcs) requireIntent(arc.key).status = stateAt(arc, CORPUS_DAYS - 1)
		for (const probe of config.probes) {
			const { arc, ...rest } = probe
			probes.push({ ...rest, targetIntentId: arc ? requireIntent(arc).id : null })
		}
	}
	return {
		version: 2,
		startDate: CORPUS_START,
		dayCount: CORPUS_DAYS,
		personas: configs.map((config) => config.profile),
		contacts: configs.flatMap((config) =>
			config.contacts.map((contact) => ({
				...contact,
				personaId: config.profile.id,
				writingStyle: contact.writingStyle ?? contactWritingStyle(contact.role)
			}))
		),
		intents,
		messages,
		artifacts,
		days,
		probes
	}
}
