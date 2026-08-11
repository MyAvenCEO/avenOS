/**
 * The product ladder — one source of truth for pricing AND the skills
 * marketplace.
 *
 * Five roles, each one the previous plus more: avenCOO runs the paperwork,
 * avenCMO the market, avenCTO the internal tools, avenCPO the product,
 * avenCEO the whole company alongside you. Every tier carries a monthly fee
 * and a revenue share that shrinks as the fee grows — the further up, the
 * more we are partners rather than a vendor.
 *
 * The skills page filters by THIS, not by publisher: what matters to a buyer
 * is which plan a skill comes with, not which of us built it.
 */

export type PlanId = 'avencoo' | 'avencmo' | 'avencto' | 'avencpo' | 'avenceo'

export interface Plan {
	id: PlanId
	name: string
	/** One line on what this role takes off your desk. */
	role: string
	eurPerMonth: number
	/** Revenue share in percent, on top of the monthly fee. */
	revenueSharePct: number
	/** What this tier adds; the tiers below are always included. */
	features: string[]
	/** Marks the tier we lead with. */
	highlight?: boolean
}

/** Ascending: each plan includes everything from the ones before it. */
export const PLANS: Plan[] = [
	{
		id: 'avencoo',
		name: 'avenCOO',
		role: 'Operations — Papierkram, Post, Zahlen',
		eurPerMonth: 377,
		revenueSharePct: 25,
		features: [
			'2 Sparks (Personal + Company)',
			'POST-Inbox',
			'E-Mail-Inbox',
			'Aller Papierkram',
			'Vorbuchhaltung',
			'Finanz-Dashboard',
			'Agent-API-Auth-Proxy',
			'Website',
			'Stripe-Shop'
		]
	},
	{
		id: 'avencmo',
		name: 'avenCMO',
		role: 'Markt — Reichweite, Inhalte, Pipeline',
		eurPerMonth: 610,
		revenueSharePct: 20,
		highlight: true,
		features: [
			'3 Sparks',
			'x Tokens',
			'Blog',
			'Social-Media-APIs',
			'CRM & Sales Tools',
			'E2EE (TEE-gehosteter Server)'
		]
	},
	{
		id: 'avencto',
		name: 'avenCTO',
		role: 'Technik — interne Werkzeuge auf Zuruf',
		eurPerMonth: 987,
		revenueSharePct: 15,
		features: ['4 Sparks', 'y Tokens', 'Composer (interne Tools bauen)']
	},
	{
		id: 'avencpo',
		name: 'avenCPO',
		role: 'Produkt — was deine Kunden anfassen',
		eurPerMonth: 1597,
		revenueSharePct: 10,
		features: ['5 Sparks', 'z Tokens', 'Composer (Kundenprodukte bauen)']
	},
	{
		id: 'avenceo',
		name: 'avenCEO',
		role: 'Das Ganze — wir sind faktisch Co-Founder',
		eurPerMonth: 2584,
		revenueSharePct: 5,
		features: [
			'Unbegrenzte Sparks',
			'Unbegrenzte interne KI-Inferenz (Fair Use) auf eigener Hardware — Wartung durch uns',
			'tokenizeit-Adapter (Community-Investments)',
			'Faktisch Co-Founder'
		]
	}
]

export const planOrder: PlanId[] = PLANS.map((p) => p.id)

export function plan(id: PlanId): Plan {
	// biome-ignore lint/style/noNonNullAssertion: PlanId is closed over PLANS.
	return PLANS.find((p) => p.id === id)!
}

/** Plans are cumulative: avenCMO contains everything avenCOO has. */
export function planIncludes(selected: PlanId, needed: PlanId): boolean {
	return planOrder.indexOf(needed) <= planOrder.indexOf(selected)
}

/** German price formatting: 1.597 €, no cents. */
export function euro(amount: number): string {
	return amount.toLocaleString('de-DE')
}
