import { euro, type Plan, type PlanId } from '$lib/pricing/plans-data'
import type { Lang } from './index'

/**
 * The skills marketplace, the skill detail page and the marketplace card —
 * the page CHROME only. The skill texts themselves already live in
 * `$lib/skills/content/{de,en}/*.json` and are picked by the loader.
 */
export type SkillsMessages = {
	marketplace: {
		title: string
		description: string
		hero: {
			eyebrow: string
			heading: string
			subheading: string
			/** HTML — our own static copy, carries <strong> emphasis. */
			paragraphHtml: string
		}
		filter: {
			label: string
			includedIn: string
			explainer: string
			count: (visible: number, total: number) => string
			compare: string
		}
		inclusion: (plan: string, total: number, inherited: number, own: number) => string
		group: {
			with: (plan: string) => string
			count: (n: number, price: string) => string
			view: (plan: string) => string
		}
		empty: string
		chain: {
			eyebrow: string
			heading: string
			paragraph: string
			steps: { slug: string; label: string; description: string }[]
			hitlLabel: string
			hitlNote: string
		}
		pricing: {
			eyebrow: string
			heading: (total: number) => string
			paragraph: string
			cta: string
		}
	}
	detail: {
		titleSoonPrefix: string
		titleSuffix: string
		comingSoon: string
		fromRealLife: string
		yourAven: string
		solvesIt: string
		gainEyebrow: string
		gainHeading: (skill: string) => string
		perWeekBack: string
		howEyebrow: string
		howHeading: string
		mechanicsEyebrow: string
		mechanicsHeading: string
		input: string
		magic: string
		output: string
		playsEyebrow: string
		playsHeading: (skill: string) => string
		valueEyebrow: string
		valueHeading: string
		standalone: string
		notAvailable: string
		standaloneTotal: string
		included: string
		noSurcharge: string
		noLockIn: string
		firstRelief: string
		setupEffort: string
		proof: string
		bonuses: string
		availability: string
		writtenBy: string
		signOff: string
		backToAll: string
	}
	card: {
		chainLabels: Record<string, string>
		soon: string
		skill: string
		saved: string
		view: string
	}
}

export const skills: Record<Lang, SkillsMessages> = {
	de: {
		marketplace: {
			title: 'Skills Marketplace — aven.ceo · Aven Skills',
			description:
				'Skills, die echte Probleme lösen — global für jeden Aven, enthalten in avenME und avenFOUNDER.',
			hero: {
				eyebrow: 'Skill Marketplace · Aven',
				heading: 'Aven Skills, die echte Probleme lösen.',
				subheading: 'Weil wir als Founder sie selbst haben.',
				paragraphHtml:
					'Diese Skills haben wir für unsere eigenen Alltage gebaut — und dogfooden sie täglich. Heute sind sie installierbar für deinen Aven. Kein Aufpreis. Kein Lock‑in. <strong class="font-medium text-foreground/85">Dein Aven. Deine Daten. Dein Stack.</strong>'
			},
			filter: {
				label: 'Filter',
				includedIn: 'Enthalten in',
				explainer:
					'avenME (pro Mensch) und avenFOUNDER (pro Firma) sind eigene Produkte. avenCOOP enthält avenFOUNDER.',
				count: (visible, total) => `${visible} von ${total} Skills enthalten`,
				compare: 'Pläne vergleichen →'
			},
			inclusion: (plan, total, inherited, own) =>
				`${plan} enthält alle ${total} Skills — die ${inherited} aus avenFOUNDER genauso wie die ${own} eigenen.`,
			group: {
				with: (plan) => `Mit ${plan}`,
				count: (n, price) => `${n} Skill${n === 1 ? '' : 's'} · ab ${price}`,
				view: (plan) => `${plan} ansehen →`
			},
			empty: 'Für diese Auswahl sind noch keine Skills hinterlegt.',
			chain: {
				eyebrow: 'Das System',
				heading: 'Kein Skill steht allein — sie komponieren.',
				paragraph:
					'Von der ersten Mail bis zur fertigen Buchung: jeder Skill gibt seine Arbeit an den nächsten weiter. human-reviewer ist der HITL‑Layer — er hört immer mit.',
				steps: [
					{ slug: 'email-manager', label: 'E‑Mail', description: 'Liest & klassifiziert' },
					{ slug: 'docs-organizer', label: 'Dokumente', description: 'OCR & Extraktion' },
					{ slug: 'brain-memorizer', label: 'Gedächtnis', description: 'Identität & Kontext' },
					{ slug: 'book-keeper', label: 'Buchhaltung', description: 'Matching & Buchung' }
				],
				hitlLabel: 'HITL Layer',
				hitlNote: 'Jeder Skill delegiert hierher, wenn echtes Urteilsvermögen gefragt ist.'
			},
			pricing: {
				eyebrow: 'Pricing',
				heading: (total) => `Alle ${total} Skills. In jedem Plan ab avenME enthalten.`,
				paragraph:
					'Kein Skill‑Marktplatz‑Lock‑in. Kein Abo pro Skill. Kein Vendor, der deine Arbeitsintelligenz hält. Du baust auf einem Stack, der dir gehört.',
				cta: 'Alle Pläne ansehen →'
			}
		},
		detail: {
			titleSoonPrefix: 'Bald · ',
			titleSuffix: ' — aven.ceo · Skills',
			comingSoon: 'Bald verfügbar',
			fromRealLife: '· Aus dem echten Alltag',
			yourAven: 'Dein Aven',
			solvesIt: 'löst das.',
			gainEyebrow: 'Was du gewinnst',
			gainHeading: (skill) => `Dein Leben nach ${skill}.`,
			perWeekBack: 'pro Woche zurückgewonnen',
			howEyebrow: 'So funktioniert es',
			howHeading: 'In deinem Alltag — vier Schritte.',
			mechanicsEyebrow: 'Die Mechanik',
			mechanicsHeading: 'Was genau passiert — ehrlich erklärt.',
			input: 'Input',
			magic: 'Magic',
			output: 'Output',
			playsEyebrow: 'Kein Skill steht allein',
			playsHeading: (skill) => `${skill} arbeitet zusammen mit:`,
			valueEyebrow: 'Was es kosten würde',
			valueHeading: 'Einzeln kaufen vs. einfach drin haben.',
			standalone: 'Standalone‑Alternativen',
			notAvailable: 'Nicht verfügbar',
			standaloneTotal: 'Gesamt standalone',
			included: 'Im Plan enthalten',
			noSurcharge: '0 € Aufpreis',
			noLockIn: 'avenME · avenFOUNDER · avenCOOP — kein Skill‑Marktplatz‑Lock‑in',
			firstRelief: 'Erste Entlastung',
			setupEffort: 'Setup‑Aufwand',
			proof: 'Beweis',
			bonuses: 'Boni',
			availability: 'Verfügbarkeit',
			writtenBy: 'Geschrieben von',
			signOff: 'Mit Überzeugung,',
			backToAll: '← Alle Skills ansehen'
		},
		card: {
			chainLabels: {
				'email-manager': 'E‑Mail',
				'docs-organizer': 'Dokumente',
				'brain-memorizer': 'Gedächtnis',
				'book-keeper': 'Buchhaltung',
				'human-reviewer': 'HITL',
				'blog-writer': 'Content',
				'calendar-organizer': 'Kalender',
				'todo-shuffler': 'Aufgaben',
				'inbox-router': 'Eingang',
				'bookmark-champion': 'Links',
				'finance-brain': 'Finanzen',
				'website-creator': 'Website',
				'checkout-builder': 'Checkout'
			},
			soon: 'Bald',
			skill: 'Skill',
			saved: 'gespart',
			view: 'Skill ansehen →'
		}
	},
	en: {
		marketplace: {
			title: 'Skills Marketplace — aven.ceo · Aven Skills',
			description:
				'Skills that solve real problems — global for every Aven, included in avenME and avenFOUNDER.',
			hero: {
				eyebrow: 'Skill Marketplace · Aven',
				heading: 'Aven Skills that solve real problems.',
				subheading: 'Because as founders, we have them ourselves.',
				paragraphHtml:
					'We built these skills for our own day-to-day — and dogfood them daily. Today they are installable for your Aven. No surcharge. No lock‑in. <strong class="font-medium text-foreground/85">Your Aven. Your data. Your stack.</strong>'
			},
			filter: {
				label: 'Filter',
				includedIn: 'Included in',
				explainer:
					'avenME (per person) and avenFOUNDER (per company) are separate products. avenCOOP includes avenFOUNDER.',
				count: (visible, total) => `${visible} of ${total} skills included`,
				compare: 'Compare plans →'
			},
			inclusion: (plan, total, inherited, own) =>
				`${plan} includes all ${total} skills — the ${inherited} from avenFOUNDER as well as its own ${own}.`,
			group: {
				with: (plan) => `With ${plan}`,
				count: (n, price) => `${n} skill${n === 1 ? '' : 's'} · from ${price}`,
				view: (plan) => `View ${plan} →`
			},
			empty: 'No skills listed for this selection yet.',
			chain: {
				eyebrow: 'The system',
				heading: 'No skill stands alone — they compose.',
				paragraph:
					'From the first email to the finished booking: every skill hands its work to the next. human-reviewer is the HITL layer — it always listens in.',
				steps: [
					{ slug: 'email-manager', label: 'Email', description: 'Reads & classifies' },
					{ slug: 'docs-organizer', label: 'Documents', description: 'OCR & extraction' },
					{ slug: 'brain-memorizer', label: 'Memory', description: 'Identity & context' },
					{ slug: 'book-keeper', label: 'Bookkeeping', description: 'Matching & booking' }
				],
				hitlLabel: 'HITL layer',
				hitlNote: 'Every skill delegates here whenever real judgement is required.'
			},
			pricing: {
				eyebrow: 'Pricing',
				heading: (total) => `All ${total} skills. Included in every plan from avenME up.`,
				paragraph:
					'No skill-marketplace lock‑in. No subscription per skill. No vendor holding your working intelligence. You build on a stack that belongs to you.',
				cta: 'View all plans →'
			}
		},
		detail: {
			titleSoonPrefix: 'Soon · ',
			titleSuffix: ' — aven.ceo · Skills',
			comingSoon: 'Coming soon',
			fromRealLife: '· From real life',
			yourAven: 'Your Aven',
			solvesIt: 'solves this.',
			gainEyebrow: 'What you gain',
			gainHeading: (skill) => `Your life after ${skill}.`,
			perWeekBack: 'per week won back',
			howEyebrow: 'How it works',
			howHeading: 'In your day-to-day — four steps.',
			mechanicsEyebrow: 'The mechanics',
			mechanicsHeading: 'What exactly happens — honestly explained.',
			input: 'Input',
			magic: 'Magic',
			output: 'Output',
			playsEyebrow: 'No skill stands alone',
			playsHeading: (skill) => `${skill} works together with:`,
			valueEyebrow: 'What it would cost',
			valueHeading: 'Buying it piece by piece vs. simply having it.',
			standalone: 'Standalone alternatives',
			notAvailable: 'Not available',
			standaloneTotal: 'Standalone total',
			included: 'Included in your plan',
			noSurcharge: '0 € surcharge',
			noLockIn: 'avenME · avenFOUNDER · avenCOOP — no skill-marketplace lock‑in',
			firstRelief: 'First relief',
			setupEffort: 'Setup effort',
			proof: 'Proof',
			bonuses: 'Bonuses',
			availability: 'Availability',
			writtenBy: 'Written by',
			signOff: 'With conviction,',
			backToAll: '← View all skills'
		},
		card: {
			chainLabels: {
				'email-manager': 'Email',
				'docs-organizer': 'Documents',
				'brain-memorizer': 'Memory',
				'book-keeper': 'Bookkeeping',
				'human-reviewer': 'HITL',
				'blog-writer': 'Content',
				'calendar-organizer': 'Calendar',
				'todo-shuffler': 'Tasks',
				'inbox-router': 'Inbox',
				'bookmark-champion': 'Links',
				'finance-brain': 'Finance',
				'website-creator': 'Website',
				'checkout-builder': 'Checkout'
			},
			soon: 'Soon',
			skill: 'Skill',
			saved: 'saved',
			view: 'View skill →'
		}
	}
}

/** "58 €/Monat" · "58 €/month" — `priceLabel` in plans-data is German-only. */
export function priceLabelFor(p: Plan, lang: Lang): string {
	if (lang === 'de') {
		return p.billing === 'once' ? `${euro(p.eurPrice)} € einmalig` : `${euro(p.eurPrice)} €/Monat`
	}
	return p.billing === 'once' ? `${euro(p.eurPrice)} € one-time` : `${euro(p.eurPrice)} €/month`
}

/** The VAT sentence under the filter — `VAT_NOTE` in plans-data is German-only. */
export const vatNote: Record<Lang, string> = {
	de: 'Alle Preise verstehen sich zzgl. der gesetzlichen Umsatzsteuer.',
	en: 'All prices excl. VAT.'
}

/** `Plan.role` is German-only in plans-data; the English line lives here. */
const planRolesEn: Record<PlanId, string> = {
	avenid: 'Your name — one account anyone can address. Per person and per company.',
	avenme: 'Your personal AI‑CEO — for your life',
	avenceo: 'Your professional AI‑CEO — for your company',
	avencoop: 'We become your technical co‑founder'
}

export function planRole(p: Plan, lang: Lang): string {
	return lang === 'en' ? (planRolesEn[p.id] ?? p.role) : p.role
}
