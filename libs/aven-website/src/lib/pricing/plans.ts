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
	/**
	 * What we keep to run the platform — every payment fee (Stripe, Creem &
	 * Co.) already inside it. 0 on the tiers that sell you nothing.
	 */
	platformFeePct: number
	/**
	 * The other half of the share, and the reason it is not called a fee: it
	 * leaves us again as an INVESTMENT into other founders' avenCOOPs, and the
	 * shares it buys are yours. This is the compounding engine — your revenue
	 * buys you a slice of everyone else's.
	 */
	reinvestPct: number
	/** Company shares we take — avenCOOP only. */
	equitySharePct?: number
	/** avenCOOP is not bookable: you apply and we decide together. */
	applyOnly?: boolean
	/** Who the tier is open to — stated, so nobody has to guess. */
	eligibility?: string
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
		eurPrice: 30,
		billing: 'once',
		platformFeePct: 0,
		reinvestPct: 0,
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
		platformFeePct: 0,
		reinvestPct: 0,
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
		platformFeePct: 6,
		reinvestPct: 6,
		highlight: true,
		features: [
			'Vorbuchhaltung',
			'Finanz‑Dashboard',
			'Agent‑API‑Auth‑Proxy',
			'Website',
			'Stripe‑Shop',
			'Blog',
			'Dein Aven und deine Produkte im aven Marketplace gelistet',
			'Company Spark zusätzlich zu deinem Personal Spark'
		]
	},
	{
		id: 'avencoop',
		name: 'avenCOOP',
		role: 'Wir werden dein technischer Co‑Founder',
		eurPrice: 1895,
		billing: 'monthly',
		platformFeePct: 6,
		reinvestPct: 12,
		equitySharePct: 5,
		applyOnly: true,
		eligibility: 'Nur für Pre‑Seed‑Startups mit weniger als 300.000 € Investment.',
		features: [
			'Wir bauen aktiv an deinem Produkt mit — faktisch dein externer CTO und Co‑Founder',
			'Begleitung durch die deutsche Gründungs‑Bürokratie: GmbH oder UG',
			'5 % Firmenanteile an deiner Firma, digitalisiert über beel.com',
			'Du wählst selbst, in welche avenCOOPs dein Reinvest fließt — unsere avenCEO GmbH steht mit zur Wahl',
			'Wir führen dein beel‑Syndikat an — mit Community‑Investments deiner Unterstützer'
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

/**
 * Platform fee plus reinvest — the share a founder actually sees leave the
 * account. The two halves are printed under it, because they are different
 * things: one is a price, the other buys shares that stay yours.
 */
export function totalSharePct(p: Plan): number {
	return p.platformFeePct + p.reinvestPct
}

/**
 * The word above the number on a plan card. Every price on the site is NET,
 * so the label carries it — a VAT note that only exists as a footnote under
 * the grid is a note half the readers never reach.
 */
export function billingLabel(p: Plan): string {
	return p.billing === 'once' ? 'Einmalig · netto' : 'Monatlich · netto'
}

/** The one VAT sentence, spelled once. */
export const VAT_NOTE = 'Alle Preise netto, zzgl. gesetzlicher Umsatzsteuer.'

/** Book it, or apply for it — avenCOOP is a decision we make together. */
export function ctaLabel(p: Plan): string {
	if (p.applyOnly) return 'Bewerben'
	return p.id === 'avenid' ? 'avenID sichern' : 'Buchen'
}

export function ctaHref(p: Plan): string {
	if (p.applyOnly) return `/waitlist?intent=coop-application&tier=${p.id}`
	return p.id === 'avenid' ? '/waitlist?intent=aven-id' : `/waitlist?intent=ceo-plan&tier=${p.id}`
}
