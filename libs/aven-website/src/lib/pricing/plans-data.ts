/**
 * The products — one source of truth for pricing AND the skills marketplace.
 *
 * NOT a ladder. avenID is the door: the name, the waitlist place, a plain
 * account anyone can address and talk to. avenME is the personal AI‑CEO for
 * your LIFE — one per human: inbox, post, documents, the daily organisation,
 * your own knowledge base. avenFOUNDER is the professional AI‑CEO for your
 * COMPANY — one per company: it runs the whole business (pre-accounting,
 * finances, website, shop, blog), is the single point every employee,
 * customer and partner talks to, and takes a share of the revenue it helps
 * produce. (Technically that company Aven is "the avenCEO" — avenFOUNDER is
 * the product you buy to get one.) avenME and avenFOUNDER are two different
 * ROLES that live side by side in one shared namespace; neither is an
 * upgrade of the other, and each company needs its own. avenCOOP
 * is not a bigger plan but a different relationship: we come in as the
 * technical co-founder, take company shares alongside the revenue share, and
 * you APPLY rather than book.
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
	/**
	 * What you earn on every aven subscription you bring in — recurring for as
	 * long as that subscription runs, not a one-off finder's fee.
	 */
	referralPct?: number
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
		eurPrice: 25,
		billing: 'once',
		referralPct: 5,
		platformFeePct: 0,
		reinvestPct: 0,
		features: [
			'Dein avenID‑Name — für 1 Jahr für dich gesichert',
			'Dein Platz auf der Warteliste',
			'20 Min Test‑Zugang — sobald du eingeladen bist',
			'Voraussetzung für avenME und avenFOUNDER — eine pro Mensch, eine pro Firma',
			'5 % Provision auf jedes aven‑Produkt, das du vermittelst — monatlich, solange es läuft'
		]
	},
	{
		id: 'avenme',
		name: 'avenME',
		role: 'Dein persönlicher AI‑CEO — für dein Leben',
		per: 'person',
		eurPrice: 58,
		billing: 'monthly',
		referralPct: 10,
		runtime: { hoursPerDay: 1, centsPerExtraMinute: 10 },
		platformFeePct: 0,
		reinvestPct: 0,
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
		per: 'company',
		eurPrice: 426,
		billing: 'monthly',
		referralPct: 15,
		runtime: { hoursPerDay: 4, centsPerExtraMinute: 8 },
		platformFeePct: 4.8,
		reinvestPct: 15,
		highlight: true,
		features: [
			{ skill: 'book-keeper', label: 'Vorbuchhaltung' },
			{ skill: 'finance-brain', label: 'Finanz‑Dashboard und Rechnungen' },
			'Agent‑API‑Auth‑Proxy',
			{ skill: 'website-creator', label: 'Website und Landingpages' },
			{ skill: 'checkout-builder', label: 'Produkt‑Checkout und Shop' },
			{ skill: 'blog-writer', label: 'Blog' },
			'Digitaler Briefkasten für Geschäftskunden (exkl. Nachsendeauftrag der Deutschen Post: 51,90 € / 6 Monate, inkl. USt.)',
			'Das Gedächtnis deiner Firma: Wissen und Erfahrung sammeln sich über Jahre im avenCEO — das wird dein wertvollstes Asset'
		]
	},
	{
		id: 'avencoop',
		name: 'avenCOOP',
		role: 'Wir werden dein technischer Co‑Founder',
		eurPrice: 1895,
		billing: 'monthly',
		referralPct: 20,
		runtime: { hoursPerDay: 12, centsPerExtraMinute: 5 },
		platformFeePct: 4.8,
		reinvestPct: 10,
		equitySharePct: 8,
		applyOnly: true,
		features: [
			'1× avenFOUNDER — der avenCEO deiner Firma — inklusive',
			'Wir bauen aktiv an deinem Produkt mit — faktisch dein externer CTO und Co‑Founder',
			'Begleitung durch die deutsche Gründungs‑Bürokratie: GmbH oder UG',
			'Du wählst selbst, in welche Aven dein Reinvest fließt — unsere avenCEO GmbH steht mit zur Wahl',
			{
				href: 'https://beel.com/de',
				label:
					'Du wirst Featured Startup in unserem beel‑Syndikat — unsere avenFOUNDER können in dich reinvestieren (exkl. beel Produktgebühren)'
			}
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
