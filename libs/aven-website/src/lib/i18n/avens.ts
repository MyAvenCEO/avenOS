import type { Lang } from './index'

/** One company Aven's reason to exist and what it actually runs. */
type CompanyProfile = { mission: string; services: string[] }

/** The Aven address book — page chrome plus each company Aven's profile. */
export type AvensMessages = {
	title: string
	description: string
	eyebrow: string
	heading: string
	/** HTML — our own static copy with inline emphasis. */
	introHtml: string
	company: { label: string; lead: string }
	person: { label: string; lead: string }
	/** Short line about the human behind a personal Aven — activated after onboarding. */
	bios: Record<string, string>
	/** Why some profiles show no link/bio yet. */
	activationNote: string
	kind: { person: string; company: string }
	behind: string
	mission: string
	services: string
	worksOn: string
	/** Keyed by Aven slug. */
	companies: Record<string, CompanyProfile>
	cta: string
}

export const avens: Record<Lang, AvensMessages> = {
	de: {
		title: 'Avens — aven.ceo · Adressbuch',
		description:
			'Das Adressbuch der Avens: welche Firmen-Avens und persönlichen Avens bereits laufen, wer dahinter steht und wofür sie da sind.',
		eyebrow: 'Adressbuch · Avens',
		heading: 'Diese Avens sind bereits live.',
		introHtml:
			'Ein Namensraum für alle: <strong class="font-medium text-foreground/85">Menschen</strong> haben ihren persönlichen Aven, <strong class="font-medium text-foreground/85">Firmen</strong> ihren avenCEO. Jeden erreichst du direkt unter seinem Namen — so wie du einem Kollegen schreibst.',
		company: {
			label: 'Firmen‑Avens',
			lead: 'Der avenCEO einer Firma — die eine Anlaufstelle für Mitarbeiter, Kunden und Partner.'
		},
		person: {
			label: 'Persönliche Avens',
			lead: 'Der Aven eines Menschen. Wer dahinter steht, ein Link und eine Zeile zur Person — mehr steht hier nicht, denn ein persönlicher Aven ist privat.'
		},
		bios: {
			sam: 'Co‑Founder der avenCEO GmbH — baut an der Vision, dass jeder Mensch mit seinem eigenen Aven gründen kann.',
			dan: 'Co‑Founder der avenCEO GmbH — der Engineering‑Architekt hinter avenOS.'
		},
		activationNote: 'Profil‑Link und Kurzbeschreibung schalten wir nach dem Onboarding frei.',
		kind: { person: 'Persönlich', company: 'Firma' },
		behind: 'Dahinter',
		mission: 'Mission',
		services: 'Leistungen',
		worksOn: 'arbeitet an',
		companies: {
			ceo: {
				mission:
					'Jeder Mensch und jede Firma bekommt einen eigenen Aven — damit Arbeitsintelligenz denen gehört, die sie aufbauen.',
				services: [
					'avenID, avenME und avenFOUNDER',
					'Skills für Avens — gebaut, betrieben, weitergegeben',
					'avenCOOP: Hands‑on Support für eigene Skillbundles im aven Marketplace',
					'Support, Chat und Social Media für alle aven‑Kunden'
				]
			},
			maia: {
				mission: 'Investiert in die Gründer von morgen.',
				services: ['Community‑Investments in aven‑Gründer']
			}
		},
		cta: 'Dein Aven fehlt hier noch?'
	},
	en: {
		title: 'Avens — aven.ceo · Address book',
		description:
			'The Aven address book: which company Avens and personal Avens are already running, who is behind them and what they are there for.',
		eyebrow: 'Address book · Avens',
		heading: 'These Avens are already live.',
		introHtml:
			'One namespace for everyone: <strong class="font-medium text-foreground/85">people</strong> have their personal Aven, <strong class="font-medium text-foreground/85">companies</strong> their avenCEO. You reach each one directly under its name — the way you would message a colleague.',
		company: {
			label: 'Company Avens',
			lead: 'The avenCEO of a company — the one point of contact for employees, customers and partners.'
		},
		person: {
			label: 'Personal Avens',
			lead: 'The Aven of a person. Who is behind it, a link and one line about them — nothing more, because a personal Aven is private.'
		},
		bios: {
			sam: 'Co-founder of avenCEO GmbH — building toward the vision that every human can found with their own Aven.',
			dan: 'Co-founder of avenCEO GmbH — the engineering architect behind avenOS.'
		},
		activationNote: 'Profile link and short description go live after onboarding.',
		kind: { person: 'Personal', company: 'Company' },
		behind: 'Behind it',
		mission: 'Mission',
		services: 'Services',
		worksOn: 'works towards',
		companies: {
			ceo: {
				mission:
					'Every human and every company gets an Aven of their own — so that working intelligence belongs to the people who build it.',
				services: [
					'avenID, avenME and avenFOUNDER',
					'Skills for Avens — built, run, handed on',
					'avenCOOP: hands-on support for your own Skillbundles in the aven Marketplace',
					'Support, chat and social media for every aven customer'
				]
			},
			maia: {
				mission: 'Invests into the founders of tomorrow.',
				services: ['Community investments into aven founders']
			}
		},
		cta: 'Your Aven is not here yet?'
	}
}
