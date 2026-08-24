/**
 * The products — one source of truth for pricing AND the skills marketplace.
 *
 * NOT a ladder. avenID is the door: the name, the waitlist place, a plain
 * account anyone can address and talk to. avenME is the personal AI‑CEO for
 * your LIFE — one per human: inbox, post, documents, the daily organisation,
 * your own knowledge base. avenFOUNDER is the professional AI‑CEO for your
 * COMPANY — one per company: it runs the whole business (pre-accounting,
 * finances, website, shop, blog), is the single point every employee,
 * customer and partner talks to. (Technically that company Aven is
 * "the avenCEO" — avenFOUNDER is
 * the product you buy to get one.) avenME and avenFOUNDER are two different
 * ROLES that live side by side in one shared namespace; neither is an
 * upgrade of the other, and each company needs its own. avenCOOP
 * is not a bigger plan but a different relationship: YOU build your own
 * sovereign Aven BUSINESS — your Skillbundle, sold under your name on our
 * infrastructure — and we sit next to you with hands-on support while you
 * do. We do not build it for you and we take no equity; the only thing we
 * take is a share of the revenue it makes. You APPLY rather than book.
 *
 * avenID is a prerequisite, not a part of any plan: every human AND every
 * company has its own name, bought alongside avenME or avenFOUNDER as a
 * bundle when it does not exist yet.
 *
 * The plan id `avenceo` is a WIRE KEY (API tier enum, Creem product map,
 * app billing, skills catalogue) and stays stable; only `name` changed.
 *
 * The five-role ladder (avenCOO/CMO/CTO/CPO/CEO) and the "Sparks" are gone:
 * the company of the future is 1 human (vision) + 1 avenCEO (execution),
 * and that needs no second noun.
 *
 * The skills page filters by THIS, not by publisher: what matters to a buyer
 * is which plan a skill comes with, not which of us built it.
 *
 * This file is pure data + pure helpers, importable from OUTSIDE SvelteKit —
 * the id service seeds its Creem products from it (`@avenos/aven-website/pricing`).
 * Keep `$lib`/Svelte imports out; anything that needs them lives in plans.ts.
 */

export type PlanId = 'avenid' | 'avenme' | 'avenceo' | 'avencoop'

/**
 * A line on a plan card. Most are plain text — but where a feature IS a
 * shipped skill, it names the skill and links to its page, so the card stops
 * describing a capability in the abstract and points at the thing that does
 * it. The slug stays a plain string: `skills/loader` imports THIS file, so an
 * import the other way would close a cycle.
 */
export type PlanFeature =
	| string
	| { skill: string; label: string }
	| { href: string; label: string }

export interface Plan {
	id: PlanId
	name: string
	/** One line on what this product takes off your desk. */
	role: string
	/**
	 * The transformation, not the feature list: 1–2 warm sentences on what
	 * this tier changes in the buyer's life. Printed between the role line
	 * and the hard facts — people buy the transformation, never the product.
	 */
	pitch: string
	/**
	 * Who a plan is bought FOR. One avenME per human, one avenFOUNDER per company:
	 * two roles that coexist, never a tier above the other. Printed on the
	 * cards so nobody reads 42 → 326 as a ladder.
	 */
	per?: 'person' | 'company'
	/**
	 * The price in euro, GROSS (incl. VAT) — the number a person pays. Monthly
	 * for every tier except avenID, which is billed once — read `billing`
	 * before you print a `/m`.
	 */
	eurPrice: number
	billing: 'once' | 'monthly'
	/**
	 * The share of the revenue your Aven produces that we keep — every payment
	 * fee (Stripe, Creem & Co.) already INSIDE it, not on top. It is the only
	 * thing we take: no equity, no second line. 0 on the tiers that sell you
	 * nothing.
	 */
	revenueSharePct: number
	/** avenCOOP is not bookable: you apply and we decide together. */
	applyOnly?: boolean
	/**
	 * The early-adopter BETA deal: a percentage off `eurPrice` for the first
	 * N months. `eurPrice` stays the regular price — the discount is a
	 * limited window on top of it, never a second price to maintain.
	 */
	beta?: { discountPct: number; months: number }
	/**
	 * Included agent runtime per day, and what a minute costs past it. Fair
	 * use is a promise about a NUMBER, so the number is data, not prose in a
	 * feature bullet where it drifts per tier.
	 */
	runtime?: { hoursPerDay: number; centsPerExtraMinute: number }
	/** What this product does. Skills cascade: avenFOUNDER carries avenME's, avenCOOP carries avenFOUNDER's. */
	features: PlanFeature[]
	/** Marks the product we lead with. */
	highlight?: boolean
}

/** Display order. Plans are NOT cumulative — see `planIncludes`. */
export const PLANS: Plan[] = [
	{
		id: 'avenid',
		name: 'avenID',
		role: 'Dein Name — ein Konto, das jeder ansprechen kann. Pro Mensch und pro Firma.',
		pitch:
			'Dein Name ist der erste Schritt in ein Leben, in dem KI für dich arbeitet — nicht für einen Konzern. Es gibt ihn genau einmal. Sichere ihn dir, bevor ihn jemand anderes trägt.',
		eurPrice: 25,
		billing: 'once',
		revenueSharePct: 0,
		features: [
			'Dein avenID‑Name — für 1 Jahr für dich gesichert',
			'Dein Platz auf der Warteliste',
			'20 Min Test‑Zugang — sobald du eingeladen bist',
			'Voraussetzung für avenME und avenFOUNDER — eine pro Mensch, eine pro Firma'
		]
	},
	{
		id: 'avenme',
		name: 'avenME',
		role: 'Dein persönlicher AI‑CEO — für dein Leben',
		pitch:
			'Dein Leben ist voller Ideen, Termine, Projekte und offener Enden — dein avenME hält alles zusammen. Er koordiniert deinen Alltag, fängt jeden Gedanken auf und macht aus losen Konzepten Dinge, die passieren.',
		per: 'person',
		eurPrice: 55,
		billing: 'monthly',
		beta: { discountPct: 50, months: 1 },
		runtime: { hoursPerDay: 1, centsPerExtraMinute: 10 },
		revenueSharePct: 0,
		features: [
			'Persönliche Live‑Organisation: Aufgaben, Termine, Erinnerungen',
			{ skill: 'inbox-router', label: 'Ein Eingang für alles' },
			{ skill: 'email-manager', label: 'E‑Mail‑Inbox' },
			'Digitaler Briefkasten — deine Papierpost digitalisiert (exkl. Nachsendeauftrag der Deutschen Post: 31,90 € / 6 Monate, inkl. USt.)',
			{ skill: 'docs-organizer', label: 'Dokumentenverwaltung' },
			{ skill: 'brain-memorizer', label: 'Notizen, Kontakte, Beziehungen' },
			{ skill: 'human-reviewer', label: 'Du entscheidest, wenn es zählt' },
			{ skill: 'calendar-organizer', label: 'Dein Kalender denkt mit' },
			{ skill: 'todo-shuffler', label: 'Deine Liste sortiert sich selbst' },
			{ skill: 'bookmark-champion', label: 'Links und Lesezeichen, wiederfindbar' },
			'Deine persönliche Wissensbasis — alles, was du lernst, bleibt bei deinem Aven',
			'Trainiert zusammen mit dir den avenCEO deiner Firma'
		]
	},
	{
		id: 'avenceo',
		name: 'avenFOUNDER',
		role: 'Dein professioneller AI‑CEO — für deine Firma',
		pitch:
			'Du hast die Vision — dein avenFOUNDER macht daraus eine Firma, die läuft. Er arbeitet, während du schläfst, und wird jeden Tag besser. So fühlt sich Gründen an, wenn es keine 80‑Stunden‑Woche mehr kostet.',
		per: 'company',
		eurPrice: 377,
		billing: 'monthly',
		beta: { discountPct: 50, months: 3 },
		runtime: { hoursPerDay: 4, centsPerExtraMinute: 8 },
		revenueSharePct: 6.8,
		highlight: true,
		features: [
			{ skill: 'book-keeper', label: 'Vorbuchhaltung' },
			{ skill: 'finance-brain', label: 'Finanz‑Dashboard und Rechnungen' },
			'Agent‑API‑Auth‑Proxy',
			{ skill: 'website-creator', label: 'Website und Landingpages' },
			{ skill: 'checkout-builder', label: 'Produkt‑Checkout und Shop' },
			{ skill: 'blog-writer', label: 'Blog' },
			'Digitaler Briefkasten für Geschäftskunden (exkl. Nachsendeauftrag der Deutschen Post: 51,90 € / 6 Monate, inkl. USt.)',
			'Im aven Marketplace gelistet — auffindbar für Kunden, Partner und andere Avens',
			'Das Gedächtnis deiner Firma: Wissen und Erfahrung sammeln sich über Jahre im avenCEO — das wird dein wertvollstes Asset'
		]
	},
	{
		id: 'avencoop',
		name: 'avenCOOP',
		role: 'Hands‑on Unterstützung für dein eigenes souveränes Aven‑Business',
		pitch:
			'Du willst nicht nur eine Firma — du willst dein eigenes Aven‑Business. Wir haben die Infrastruktur gebaut und stehen neben dir, bis dein Skillbundle im Marketplace steht. Deine Idee, dein Name, dein Werk.',
		eurPrice: 987,
		billing: 'monthly',
		beta: { discountPct: 50, months: 6 },
		runtime: { hoursPerDay: 12, centsPerExtraMinute: 5 },
		revenueSharePct: 9.5,
		applyOnly: true,
		features: [
			'Hands‑on Unterstützung, während DU dein Skillbundle baust — dein Produkt, dein Name, unsere Infrastruktur',
			'Du verkaufst es selbst im aven Marketplace — dein Bundle, dein Preis, deine Kunden',
			'Souveränität, die du weitergibst: deine Kunden behalten ihre eigenen Schlüssel — nicht du, nicht wir',
			'Begleitung durch die deutsche Gründungs‑Bürokratie: GmbH oder UG'
		]
	}
]

export const planOrder: PlanId[] = PLANS.map((p) => p.id)

export function plan(id: PlanId): Plan {
	// biome-ignore lint/style/noNonNullAssertion: PlanId is closed over PLANS.
	return PLANS.find((p) => p.id === id)!
}

/**
 * Which plan's SKILLS a plan carries. avenME and avenFOUNDER are separate
 * products for separate roles (person / company) — you buy both if you are
 * both — but the company's Aven has every skill the personal one has, and
 * avenCOOP ships with the company's avenFOUNDER. avenID carries nothing.
 */
const SKILL_CASCADE: PlanId[] = ['avenme', 'avenceo', 'avencoop']
export function planIncludes(selected: PlanId, needed: PlanId): boolean {
	if (selected === needed) return true
	const s = SKILL_CASCADE.indexOf(selected)
	const n = SKILL_CASCADE.indexOf(needed)
	return s >= 0 && n >= 0 && n < s
}

/** "pro Mensch" · "pro Firma" — the role a plan is bought for. */
export function perLabel(p: Plan): string | null {
	if (p.per === 'person') return 'pro Mensch'
	if (p.per === 'company') return 'pro Firma'
	return null
}

/** German price formatting: 1.234,50 €, cents only when there are any. */
export function euro(amount: number): string {
	// Whole euros stay whole (25 €, 377 €); a half-euro BETA price prints its
	// cents in full (188,50 €), never as a stray "188,5".
	const cents = Number.isInteger(amount) ? 0 : 2
	return amount.toLocaleString('de-DE', {
		minimumFractionDigits: cents,
		maximumFractionDigits: cents
	})
}

/** What an early adopter actually pays during the BETA window. */
export function betaPrice(p: Plan): number | null {
	if (!p.beta) return null
	return Math.round(p.eurPrice * (1 - p.beta.discountPct / 100) * 100) / 100
}

/** "25 € einmalig" · "377 €/Monat" — the whole price in one string. */
export function priceLabel(p: Plan): string {
	return p.billing === 'once' ? `${euro(p.eurPrice)} € einmalig` : `${euro(p.eurPrice)} €/Monat`
}

/**
 * The cadence and the VAT clause, on the same line as the number — a price
 * reads as one statement, not as a label stacked on a figure.
 */
export function priceSuffix(p: Plan): string {
	return p.billing === 'once' ? 'einmalig · inkl. USt.' : '/Monat · inkl. USt.'
}

/**
 * The one VAT sentence, spelled once. "Netto" alone does not carry it — the
 * explicit clause does.
 */
export const VAT_NOTE = 'Alle Preise verstehen sich inkl. der gesetzlichen Umsatzsteuer.'
