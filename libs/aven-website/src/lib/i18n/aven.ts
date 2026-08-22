import type { Lang } from './index'

/** The Aven address book — page chrome plus the localised service lines per Aven. */
export type AvenMessages = {
	title: string
	description: string
	eyebrow: string
	heading: string
	/** HTML — our own static copy with inline emphasis. */
	introHtml: string
	company: { label: string; lead: string }
	person: { label: string; lead: string }
	kind: { person: string; company: string }
	holder: string
	services: string
	skills: string
	live: string
	soon: string
	runsOn: string
	/** What each Aven already does — keyed by its slug. */
	doing: Record<string, string[]>
	cta: string
}

export const aven: Record<Lang, AvenMessages> = {
	de: {
		title: 'Aven — aven.ceo · Adressbuch',
		description:
			'Alle Aven, die bereits laufen: persönliche Aven für Menschen, avenCEOs für Firmen — und was sie heute schon erledigen.',
		eyebrow: 'Adressbuch · Aven',
		heading: 'Diese Aven sind bereits live.',
		introHtml:
			'Ein Namensraum für alle: <strong class="font-medium text-foreground/85">Menschen</strong> haben ihren persönlichen Aven, <strong class="font-medium text-foreground/85">Firmen</strong> ihren avenCEO. Jeden Aven erreichst du direkt unter seinem Namen — so wie du einen Kollegen anschreibst.',
		company: {
			label: 'Firmen‑Aven',
			lead: 'Der avenCEO einer Firma — die eine Anlaufstelle für Mitarbeiter, Kunden und Partner.'
		},
		person: {
			label: 'Persönliche Aven',
			lead: 'Der Aven eines Menschen — sein Leben, sein Wissen, sein Training für die Firmen‑Aven.'
		},
		kind: { person: 'Persönlich', company: 'Firma' },
		holder: 'Gehört',
		services: 'Macht heute',
		skills: 'Skills',
		live: 'live',
		soon: 'bald',
		runsOn: 'läuft auf',
		doing: {
			ceo: [
				'Führt die avenCEO GmbH — die Firma, die aven.ceo baut',
				'Beantwortet Support, Chat und Social Media für alle aven‑Kunden',
				'Vorbuchhaltung, Rechnungen und Finanzen der avenCEO GmbH',
				'Baut und betreibt diese Website und den Checkout',
				'Sammelt, was avenSAM und avenDAN ihm beibringen'
			],
			sam: [
				'Sortiert Samuels Post, E‑Mails und Dokumente',
				'Hält Kontakte, Notizen und Beziehungen im Gedächtnis',
				'Trainiert avenCEO mit Samuels Entscheidungen'
			],
			dan: [
				'Sortiert Daniels Post, E‑Mails und Dokumente',
				'Hält Kontakte, Notizen und Beziehungen im Gedächtnis',
				'Trainiert avenCEO mit Daniels Entscheidungen'
			]
		},
		cta: 'Dein Aven fehlt hier noch?'
	},
	en: {
		title: 'Aven — aven.ceo · Address book',
		description:
			'Every Aven already running: personal Aven for people, avenCEOs for companies — and what they already do today.',
		eyebrow: 'Address book · Aven',
		heading: 'These Aven are already live.',
		introHtml:
			'One namespace for everyone: <strong class="font-medium text-foreground/85">people</strong> have their personal Aven, <strong class="font-medium text-foreground/85">companies</strong> their avenCEO. You reach every Aven directly under its name — the way you would message a colleague.',
		company: {
			label: 'Company Aven',
			lead: 'The avenCEO of a company — the one point of contact for employees, customers and partners.'
		},
		person: {
			label: 'Personal Aven',
			lead: 'The Aven of a person — their life, their knowledge, their training for the company Aven.'
		},
		kind: { person: 'Personal', company: 'Company' },
		holder: 'Belongs to',
		services: 'Already does',
		skills: 'Skills',
		live: 'live',
		soon: 'soon',
		runsOn: 'runs on',
		doing: {
			ceo: [
				'Runs the avenCEO GmbH — the company building aven.ceo',
				'Answers support, chat and social media for every aven customer',
				'Pre-accounting, invoices and finances of the avenCEO GmbH',
				'Builds and operates this website and the checkout',
				'Collects what avenSAM and avenDAN teach it'
			],
			sam: [
				'Sorts Samuel’s mail, email and documents',
				'Keeps contacts, notes and relationships in memory',
				'Trains avenCEO with Samuel’s decisions'
			],
			dan: [
				'Sorts Daniel’s mail, email and documents',
				'Keeps contacts, notes and relationships in memory',
				'Trains avenCEO with Daniel’s decisions'
			]
		},
		cta: 'Your Aven is not here yet?'
	}
}
