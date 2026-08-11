/**
 * The product ladder — one source of truth for pricing AND the skills
 * marketplace.
 *
 * Five roles, each one the previous plus more: avenCOO runs the paperwork,
 * avenCTO the internal tools and the encrypted ground it stands on, avenCMO
 * the market, avenCPO the product, avenCEO the whole company alongside you. Every tier carries a monthly fee
 * and a revenue share that GROWS with the role — the further up, the deeper
 * we are in the outcome, until avenCEO is effectively a co-founder deal.
 *
 * The skills page filters by THIS, not by publisher: what matters to a buyer
 * is which plan a skill comes with, not which of us built it.
 */

export type PlanId = 'avencoo' | 'avencto' | 'avencmo' | 'avencpo' | 'avenceo'

export interface Plan {
	id: PlanId
	name: string
	/** One line on what this role takes off your desk. */
	role: string
	eurPerMonth: number
	/** Revenue share in percent, on top of the monthly fee; rises with the tier. */
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
		revenueSharePct: 5,
		features: [
			'avenCEO-Name inklusive (maia.aven.ceo + mail@maia.aven.ceo)',
			'2 Sparks (Personal + Company)',
			'Max. 1 Std KI/Tag (Fair Use)',
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
		id: 'avencto',
		name: 'avenCTO',
		role: 'Technik — interne Werkzeuge auf Zuruf',
		eurPerMonth: 610,
		revenueSharePct: 10,
		features: [
			'3 Sparks',
			'Max. 2 Std KI/Tag (Fair Use)',
			'Composer (interne Tools bauen)',
			'E2EE (TEE-gehosteter Server)'
		]
	},
	{
		id: 'avencmo',
		name: 'avenCMO',
		role: 'Markt — Reichweite, Inhalte, Pipeline',
		eurPerMonth: 987,
		revenueSharePct: 15,
		highlight: true,
		features: [
			'4 Sparks',
			'Max. 3 Std KI/Tag (Fair Use)',
			'Blog',
			'Social-Media-APIs',
			'CRM & Sales Tools'
		]
	},
	{
		id: 'avencpo',
		name: 'avenCPO',
		role: 'Produkt — was deine Kunden anfassen',
		eurPerMonth: 1597,
		revenueSharePct: 20,
		features: [
			'5 Sparks',
			'Max. 6 Std KI/Tag (Fair Use)',
			'Composer (Kundenprodukte bauen)',
			'Offizieller Marketplace-Reseller: wir verkaufen deine Produkte auf Kommission und übernehmen Steuerlast und Abwicklung'
		]
	},
	{
		id: 'avenceo',
		name: 'avenCEO',
		role: 'Das Ganze — wir sind faktisch Co-Founder',
		eurPerMonth: 2584,
		revenueSharePct: 25,
		features: [
			'Unbegrenzte Sparks',
			'24 Std KI/Tag (Fair Use) — unbegrenzte interne Inferenz auf eigener Hardware, Wartung durch uns',
			'tokenizeit-Adapter (Community-Investments)',
			'Offizieller Marketplace-Reseller inklusive — Kommission, Steuerlast und Abwicklung liegen bei uns',
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
