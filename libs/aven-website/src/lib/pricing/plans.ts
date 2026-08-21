/**
 * The product ladder — one source of truth for pricing AND the skills
 * marketplace.
 *
 * THREE tiers on top of one name. avenID is the door: the name, the waitlist
 * place, the open-source code. avenME runs your personal life — inbox, post,
 * documents, the daily organisation. avenCEO runs the company around it —
 * pre-accounting, finances, the website, the shop, the blog — and takes a
 * share of the revenue it helps produce. avenCOOP is not a bigger plan but a
 * different relationship: we come in as the technical co-founder, take
 * company shares alongside the revenue share, and you APPLY rather than book.
 *
 * The five-role ladder (avenCOO/CMO/CTO/CPO/CEO) is gone: it sold seniority
 * titles where buyers were asking one question — is this my life or my
 * company? Two answers, one door, one partnership.
 *
 * The skills page filters by THIS, not by publisher: what matters to a buyer
 * is which plan a skill comes with, not which of us built it.
 */

export type PlanId = 'avenid' | 'avenme' | 'avenceo' | 'avencoop'

export interface Plan {
	id: PlanId
	name: string
	/** One line on what this tier takes off your desk. */
	role: string
	/**
	 * The price in euro, NET. Monthly for every tier except avenID, which is
	 * billed once — read `billing` before you print a `/m`.
	 */
	eurPrice: number
	billing: 'once' | 'monthly'
	/** Revenue share in percent, on top of the fee. 0 on the lower tiers. */
	revenueSharePct: number
	/** What the revenue share covers, where that needs saying. */
	revenueShareNote?: string
	/** Company shares we take — avenCOOP only. */
	equitySharePct?: number
	/**
	 * Shares of OUR company the partner gets back — avenCOOP only. The deal
	 * runs both ways, so the number is stated on the card, not in a footnote.
	 */
	reciprocalSharePct?: number
	/** avenCOOP is not bookable: you apply and we decide together. */
	applyOnly?: boolean
	/** What this tier adds; the tiers below are always included. */
	features: string[]
	/** One outbound reference, where the tier depends on one. */
	link?: { href: string; label: string }
	/** Marks the tier we lead with. */
	highlight?: boolean
}

/** Ascending: each plan includes everything from the ones before it. */
export const PLANS: Plan[] = [
	{
		id: 'avenid',
		name: 'avenID',
		role: 'Dein Name — der Anfang von allem',
		eurPrice: 25,
		billing: 'once',
		revenueSharePct: 0,
		features: [
			'Dein avenID‑Name — für 1 Jahr für dich gesichert',
			'Dein Platz auf der Warteliste',
			'20 Min Test‑Zugang — sobald du eingeladen bist'
		]
	},
	{
		id: 'avenme',
		name: 'avenME',
		role: 'Dein Leben — organisiert, jeden Tag',
		eurPrice: 42,
		billing: 'monthly',
		revenueSharePct: 0,
		features: [
			'Persönliche Live‑Organisation: Aufgaben, Termine, Erinnerungen',
			'E‑Mail‑Inbox',
			'POST‑Inbox — deine Papierpost digitalisiert',
			'Dokumentenverwaltung',
			'Dein Brain: Notizen, Kontakte, Kalender',
			'Personal Spark · max. 1 Std KI/Tag (Fair Use)'
		]
	},
	{
		id: 'avenceo',
		name: 'avenCEO',
		role: 'Deine Firma — alles Geschäftliche',
		eurPrice: 326,
		billing: 'monthly',
		revenueSharePct: 8,
		revenueShareNote: 'inklusive aller Zahlungsgebühren (Stripe, Creem & Co.)',
		highlight: true,
		features: [
			'Vorbuchhaltung',
			'Finanz‑Dashboard',
			'Agent‑API‑Auth‑Proxy',
			'Website',
			'Stripe‑Shop',
			'Blog',
			'Company Spark zusätzlich zu deinem Personal Spark'
		]
	},
	{
		id: 'avencoop',
		name: 'avenCOOP',
		role: 'Wir werden dein technischer Co‑Founder',
		eurPrice: 1895,
		billing: 'monthly',
		revenueSharePct: 15,
		equitySharePct: 5,
		reciprocalSharePct: 0.5,
		applyOnly: true,
		features: [
			'Wir bauen aktiv an deinem Produkt mit — faktisch dein externer CTO und Co‑Founder',
			'Begleitung durch die deutsche Gründungs‑Bürokratie: GmbH oder UG',
			'5 % Firmenanteile an deiner Firma, tokenisiert über beel.com',
			'0,5 % Beteiligung an der avenCEO GmbH — die Partnerschaft geht in beide Richtungen',
			'Community‑Investments über beel',
			'Wir führen dein beel‑Syndikat an'
		],
		link: { href: 'https://beel.com/de', label: 'beel.com' }
	}
]

export const planOrder: PlanId[] = PLANS.map((p) => p.id)

export function plan(id: PlanId): Plan {
	// biome-ignore lint/style/noNonNullAssertion: PlanId is closed over PLANS.
	return PLANS.find((p) => p.id === id)!
}

/** Plans are cumulative: avenCEO contains everything avenME has. */
export function planIncludes(selected: PlanId, needed: PlanId): boolean {
	return planOrder.indexOf(needed) <= planOrder.indexOf(selected)
}

/** German price formatting: 1.895 €, no cents. */
export function euro(amount: number): string {
	return amount.toLocaleString('de-DE')
}

/** "25 € einmalig" · "326 €/Monat" — the whole price in one string. */
export function priceLabel(p: Plan): string {
	return p.billing === 'once' ? `${euro(p.eurPrice)} € einmalig` : `${euro(p.eurPrice)} €/Monat`
}

/** The word above the number on a plan card. */
export function billingLabel(p: Plan): string {
	return p.billing === 'once' ? 'Einmalig' : 'Monatlich'
}

/** Book it, or apply for it — avenCOOP is a decision we make together. */
export function ctaLabel(p: Plan): string {
	if (p.applyOnly) return 'Bewerben'
	return p.id === 'avenid' ? 'avenID sichern' : 'Buchen'
}

export function ctaHref(p: Plan): string {
	if (p.applyOnly) return `/waitlist?intent=coop-application&tier=${p.id}`
	return p.id === 'avenid' ? '/waitlist?intent=aven-id' : `/waitlist?intent=ceo-plan&tier=${p.id}`
}
