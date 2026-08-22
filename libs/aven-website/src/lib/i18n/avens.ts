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
	kind: { person: string; company: string }
	behind: string
	mission: string
	services: string
	worksOn: string
	runsOn: string
	/** Keyed by Aven slug. */
	companies: Record<string, CompanyProfile>
	cta: string
}

export const avens: Record<Lang, AvensMessages> = {
	de: {
		title: 'Avens — aven.ceo · Adressbuch',
		description:
			'Das Adressbuch der Aven: welche Firmen-Aven und persönlichen Aven bereits laufen, wer dahinter steht und wofür sie da sind.',
		eyebrow: 'Adressbuch · Avens',
		heading: 'Diese Aven sind bereits live.',
		introHtml:
			'Ein Namensraum für alle: <strong class="font-medium text-foreground/85">Menschen</strong> haben ihren persönlichen Aven, <strong class="font-medium text-foreground/85">Firmen</strong> ihren avenCEO. Jeden erreichst du direkt unter seinem Namen — so wie du einem Kollegen schreibst.',
		company: {
			label: 'Firmen‑Aven',
			lead: 'Der avenCEO einer Firma — die eine Anlaufstelle für Mitarbeiter, Kunden und Partner.'
		},
		person: {
			label: 'Persönliche Aven',
			lead: 'Der Aven eines Menschen. Wer dahinter steht — mehr steht hier nicht, denn ein persönlicher Aven ist privat.'
		},
		kind: { person: 'Persönlich', company: 'Firma' },
		behind: 'Dahinter',
		mission: 'Mission',
		services: 'Leistungen',
		worksOn: 'arbeitet an',
		runsOn: 'läuft auf',
		companies: {
			ceo: {
				mission:
					'Jeder Mensch und jede Firma bekommt einen eigenen Aven — damit Arbeitsintelligenz denen gehört, die sie aufbauen.',
				services: [
					'avenID, avenME und avenFOUNDER',
					'Skills für Aven — gebaut, betrieben, weitergegeben',
					'avenCOOP: technischer Co‑Founder für Gründer',
					'Support, Chat und Social Media für alle aven‑Kunden'
				]
			},
			maia: {
				mission:
					'Investiert in die Gründer von morgen — und hält die Beteiligungen, die daraus wachsen.',
				services: [
					'Beteiligungen an avenCOOP‑Co‑Founderships',
					'Reinvest in die Aven anderer Gründer',
					'Community‑Investments über das beel‑Syndikat'
				]
			}
		},
		cta: 'Dein Aven fehlt hier noch?'
	},
	en: {
		title: 'Avens — aven.ceo · Address book',
		description:
			'The Aven address book: which company Aven and personal Aven are already running, who is behind them and what they are there for.',
		eyebrow: 'Address book · Avens',
		heading: 'These Aven are already live.',
		introHtml:
			'One namespace for everyone: <strong class="font-medium text-foreground/85">people</strong> have their personal Aven, <strong class="font-medium text-foreground/85">companies</strong> their avenCEO. You reach each one directly under its name — the way you would message a colleague.',
		company: {
			label: 'Company Aven',
			lead: 'The avenCEO of a company — the one point of contact for employees, customers and partners.'
		},
		person: {
			label: 'Personal Aven',
			lead: 'The Aven of a person. Who is behind it — nothing more, because a personal Aven is private.'
		},
		kind: { person: 'Personal', company: 'Company' },
		behind: 'Behind it',
		mission: 'Mission',
		services: 'Services',
		worksOn: 'works towards',
		runsOn: 'runs on',
		companies: {
			ceo: {
				mission:
					'Every human and every company gets an Aven of their own — so that working intelligence belongs to the people who build it.',
				services: [
					'avenID, avenME and avenFOUNDER',
					'Skills for Aven — built, run, handed on',
					'avenCOOP: technical co-founder for founders',
					'Support, chat and social media for every aven customer'
				]
			},
			maia: {
				mission:
					'Invests into the founders of tomorrow — and holds the stakes that grow out of it.',
				services: [
					'Stakes in avenCOOP co-founderships',
					'Reinvest into other founders’ Aven',
					'Community investments through the beel syndicate'
				]
			}
		},
		cta: 'Your Aven is not here yet?'
	}
}
