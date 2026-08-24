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
 * The plan id `avenceo` is a WIRE KEY (API tier enum, Polar `metadata.tier`,
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
 * it lives in the brand package (`@avenos/aven-brand/pricing`) as the single
 * SSOT: the website renders its product pages from it, the id service syncs
 * its Polar products from it (tier → `metadata.tier`, gross price → the
 * tax-inclusive price amount), and the app's billing pane labels from it.
 * Keep `$lib`/Svelte imports out; anything that needs them lives in the
 * website's plans.ts.
 */

export type PlanId = 'avenid' | 'avenme' | 'avenceo' | 'avencoop'

/**
 * A line on a plan card — and a REAL benefit at the payment provider: every
 * feature becomes its own Polar benefit, titled by `title`. That is why the
 * title is hard-capped at 42 chars (Polar's benefit description limit) and
 * why the longer promise lives in `description`, which only our own surfaces
 * print (the muted subline on the cards) — never the provider. Where a
 * feature IS a shipped skill, `skill` names it and links to its page; the
 * slug stays a plain string: `skills/loader` imports THIS file, so an import
 * the other way would close a cycle.
 */
export interface PlanFeature {
	/** Short punchy title, HARD ≤42 chars — it IS the Polar benefit title. */
	title: string
	/** One warm sentence expanding the title's promise — our surfaces only. */
	description: string
	/** Set where the feature is a shipped skill: the skill page slug. */
	skill?: string
	/** Set where the feature points at a page instead. */
	href?: string
}

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
	 * fee (Stripe, Polar & Co.) already INSIDE it, not on top. It is the only
	 * thing we take: no equity, no second line. 0 on the tiers that sell you
	 * nothing.
	 */
	revenueSharePct: number
	/**
	 * What the share already contains, when it is more than the default
	 * transaction-fee note — avenCOOP's 30 % swallows app-store fees & co.
	 * because we sell as the official merchant of record.
	 */
	revenueShareNote?: string
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
			{
				title: 'Dein avenID‑Name',
				description: 'Für 1 Jahr für dich gesichert — niemand sonst kann ihn tragen.'
			},
			{
				title: 'Dein Platz auf der Warteliste',
				description: 'Du stehst fest in der Reihe — sobald wir öffnen, bist du dran.'
			},
			{
				title: '20 Min Test‑Zugang',
				description: 'Sobald du eingeladen bist, probierst du deinen Aven 20 Minuten live aus.'
			},
			{
				title: 'Dein Profil im aven Marketplace',
				description:
					'Präsentiere deine Vision oder Idee mit einem eigenen Profil — sichtbar für alle Avens.'
			}
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
			{
				title: 'Persönliche Live‑Organisation',
				description:
					'Aufgaben, Termine und Erinnerungen ordnen sich um deinen Tag — nicht umgekehrt.'
			},
			{
				skill: 'inbox-router',
				title: 'Ein Eingang für alles',
				description:
					'E‑Mail, Post, Nachrichten und Gedanken landen an einem Ort — dein Aven sortiert sie.'
			},
			{
				skill: 'email-manager',
				title: 'E‑Mail‑Inbox',
				description:
					'Dein Aven liest mit, antwortet in deinem Ton und hält deinen Posteingang leer.'
			},
			{
				title: 'Digitaler Briefkasten',
				description:
					'Deine Papierpost kommt digitalisiert bei deinem Aven an (exkl. Nachsendeauftrag der Deutschen Post: 31,90 € / 6 Monate, inkl. USt.).'
			},
			{
				skill: 'docs-organizer',
				title: 'Dokumentenverwaltung',
				description:
					'Verträge, Rechnungen, Unterlagen — abgelegt, benannt und wiedergefunden, ohne dass du suchst.'
			},
			{
				skill: 'brain-memorizer',
				title: 'Notizen, Kontakte, Beziehungen',
				description:
					'Dein Aven merkt sich, wer wer ist und was euch verbindet — nichts geht mehr verloren.'
			},
			{
				skill: 'human-reviewer',
				title: 'Du entscheidest, wenn es zählt',
				description:
					'Bei allem, was wirklich wichtig ist, fragt dein Aven erst dich — du behältst das letzte Wort.'
			},
			{
				skill: 'calendar-organizer',
				title: 'Dein Kalender denkt mit',
				description: 'Termine, Wege und Puffer planen sich selbst — du schaust nur noch drauf.'
			},
			{
				skill: 'todo-shuffler',
				title: 'Deine Liste sortiert sich selbst',
				description:
					'Was heute zählt, steht oben — dein Aven priorisiert nach dem, was wirklich ansteht.'
			},
			{
				skill: 'bookmark-champion',
				title: 'Links und Lesezeichen, wiederfindbar',
				description:
					'Alles, was du speicherst, ist in Sekunden wieder da — sortiert und durchsuchbar.'
			},
			{
				title: 'Deine persönliche Wissensbasis',
				description:
					'Alles, was du lernst und sammelst, bleibt bei deinem Aven — und macht ihn jeden Tag besser.'
			},
			{
				title: 'Trainiert den avenCEO deiner Firma',
				description:
					'Dein avenME gibt weiter, was er mit dir lernt — dein Firmen‑Aven startet nie bei null.'
			}
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
		revenueSharePct: 8.2,
		highlight: true,
		features: [
			{
				skill: 'book-keeper',
				title: 'Vorbuchhaltung',
				description:
					'Belege, Konten, Abstimmung — vorbereitet für deine Steuerkanzlei, ohne Stapel auf dem Tisch.'
			},
			{
				skill: 'finance-brain',
				title: 'Finanz‑Dashboard und Rechnungen',
				description:
					'Du siehst jederzeit, wo deine Firma steht — und Rechnungen schreiben sich von selbst.'
			},
			{
				title: 'Agent‑API‑Auth‑Proxy',
				description:
					'Dein Aven nutzt Dienste und APIs in deinem Namen — sicher, ohne deine Schlüssel preiszugeben.'
			},
			{
				skill: 'website-creator',
				title: 'Website und Landingpages',
				description:
					'Deine Website entsteht aus deiner Vision — und bleibt aktuell, ohne dass du sie anfasst.'
			},
			{
				skill: 'checkout-builder',
				title: 'Produkt‑Checkout und Shop',
				description:
					'Verkaufe Produkte und Leistungen direkt — Checkout, Zahlung und Belege laufen von allein.'
			},
			{
				skill: 'blog-writer',
				title: 'Blog',
				description:
					'Dein Aven schreibt und veröffentlicht in deinem Ton — deine Geschichte bleibt hörbar.'
			},
			{
				title: 'Digitaler Briefkasten für deine Firma',
				description:
					'Die Geschäftspost deiner Firma kommt digitalisiert an (exkl. Nachsendeauftrag der Deutschen Post: 51,90 € / 6 Monate, inkl. USt.).'
			},
			{
				title: 'Im aven Marketplace gelistet',
				description:
					'Deine Firma ist auffindbar für Kunden, Partner und andere Avens — vom ersten Tag an.'
			},
			{
				title: 'Das Gedächtnis deiner Firma',
				description:
					'Wissen und Erfahrung sammeln sich über Jahre im avenCEO — das wird dein wertvollstes Asset.'
			}
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
		revenueSharePct: 30,
		revenueShareNote: 'inkl. App‑Store‑Gebühren & Co.',
		applyOnly: true,
		features: [
			{
				title: 'Hands‑on bis dein Bundle steht',
				description:
					'Wir arbeiten neben dir, während DU dein Skillbundle baust — dein Produkt, dein Name, unsere Infrastruktur.'
			},
			{
				title: 'Verkauf im aven Marketplace',
				description:
					'Du verkaufst dein Bundle selbst — dein Preis, deine Kunden, dein Name auf dem Produkt.'
			},
			{
				title: 'Rundum‑sorglos‑Abrechnung',
				description:
					'Wir verkaufen als offizieller Merchant of Record — App‑Store‑Gebühren & Co. stecken in den 30 %, du bekommst wöchentlich deine Auszahlung.'
			},
			{
				title: 'Souveränität, die du weitergibst',
				description: 'Deine Kunden behalten ihre eigenen Schlüssel — nicht du, nicht wir.'
			},
			{
				title: 'Begleitung bei der Gründung',
				description: 'Wir führen dich durch die deutsche Gründungs‑Bürokratie — GmbH oder UG.'
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

// ---------------------------------------------------------------------------
// Bilingual texts. German is the AUTHORED language — the strings on the PLANS
// above — and the English translations live right next to them so both faces
// of every product come from this one file: the website localizes its cards
// from here, and the Polar product descriptions are built from the German
// originals (Polar's Localized Checkout translates the checkout chrome, not
// our copy).

export type PlanLang = 'de' | 'en'

/** A feature's two lines in one language: the punchy title (≤42 chars) and
 * the one-sentence promise underneath. */
export interface PlanFeatureText {
	title: string
	description: string
}

/** Per plan: the role line, the pitch, and the feature texts, in feature order. */
export interface PlanTexts {
	role: string
	pitch: string
	features: PlanFeatureText[]
}

/** The English translations, keyed like PLANS; features in feature order. */
const PLAN_TEXTS_EN: Record<PlanId, PlanTexts> = {
	avenid: {
		role: 'Your name — one account anyone can address. Per human and per company.',
		pitch:
			'Your name is the first step into a life where AI works for you — not for a corporation. It exists exactly once. Claim it before someone else carries it.',
		features: [
			{
				title: 'Your avenID name',
				description: 'Reserved for you for 1 year — nobody else can carry it.'
			},
			{
				title: 'Your place on the waiting list',
				description: 'Your spot in line is fixed — the moment we open, it is your turn.'
			},
			{
				title: '20 min of trial access',
				description: 'The moment you are invited, you try your Aven live for 20 minutes.'
			},
			{
				title: 'Your profile in the aven Marketplace',
				description: 'Present your vision or idea with your own profile — visible to every Aven.'
			}
		]
	},
	avenme: {
		role: 'Your personal AI‑CEO — for your life',
		pitch:
			'Your life is full of ideas, appointments, projects and open threads — your avenME holds it all together. It coordinates your day, catches every thought and turns loose concepts into things that happen.',
		features: [
			{
				title: 'Personal live organisation',
				description:
					'Tasks, appointments and reminders arrange themselves around your day — not the other way round.'
			},
			{
				title: 'One inbox for everything',
				description: 'Email, mail, messages and thoughts land in one place — your Aven sorts them.'
			},
			{
				title: 'Email inbox',
				description: 'Your Aven reads along, replies in your tone and keeps your inbox empty.'
			},
			{
				title: 'Digital mailbox',
				description:
					'Your paper mail arrives digitised at your Aven (excl. Deutsche Post mail forwarding: 31.90 € / 6 months, incl. VAT).'
			},
			{
				title: 'Document management',
				description:
					'Contracts, invoices, paperwork — filed, named and found again without you searching.'
			},
			{
				title: 'Notes, contacts, relationships',
				description:
					'Your Aven remembers who is who and what connects you — nothing gets lost any more.'
			},
			{
				title: 'You decide when it counts',
				description:
					'For everything that really matters, your Aven asks you first — you keep the last word.'
			},
			{
				title: 'Your calendar thinks ahead',
				description:
					'Appointments, travel time and buffers plan themselves — you just glance at it.'
			},
			{
				title: 'Your list sorts itself',
				description:
					'What counts today sits on top — your Aven prioritises by what is actually due.'
			},
			{
				title: 'Links & bookmarks, findable again',
				description: 'Everything you save is back in seconds — sorted and searchable.'
			},
			{
				title: 'Your personal knowledge base',
				description:
					'Everything you learn and collect stays with your Aven — and makes it better every day.'
			},
			{
				title: 'Trains your company’s avenCEO',
				description:
					'Your avenME passes on what it learns with you — your company Aven never starts from zero.'
			}
		]
	},
	avenceo: {
		role: 'Your professional AI‑CEO — for your company',
		pitch:
			'You bring the vision — your avenFOUNDER turns it into a company that runs. It works while you sleep and gets better every day. This is what founding feels like when it no longer costs an 80-hour week.',
		features: [
			{
				title: 'Pre-accounting',
				description:
					'Receipts, accounts, reconciliation — prepared for your tax advisor, no pile on the desk.'
			},
			{
				title: 'Finance dashboard and invoices',
				description:
					'You see where your company stands at any moment — and invoices write themselves.'
			},
			{
				title: 'Agent API auth proxy',
				description:
					'Your Aven uses services and APIs on your behalf — securely, without exposing your keys.'
			},
			{
				title: 'Website and landing pages',
				description:
					'Your website grows out of your vision — and stays current without you touching it.'
			},
			{
				title: 'Product checkout and shop',
				description:
					'Sell products and services directly — checkout, payment and receipts run on their own.'
			},
			{
				title: 'Blog',
				description: 'Your Aven writes and publishes in your tone — your story stays audible.'
			},
			{
				title: 'Digital mailbox for your company',
				description:
					'Your company’s business mail arrives digitised (excl. Deutsche Post mail forwarding: 51.90 € / 6 months, incl. VAT).'
			},
			{
				title: 'Listed in the aven Marketplace',
				description:
					'Your company is findable by customers, partners and other Avens — from day one.'
			},
			{
				title: 'The memory of your company',
				description:
					'Knowledge and experience accumulate in the avenCEO over the years — that becomes your most valuable asset.'
			}
		]
	},
	avencoop: {
		role: 'Hands-on support for your own sovereign Aven business',
		pitch:
			'You do not just want a company — you want your own Aven business. We built the infrastructure and stand beside you until your Skillbundle is live in the Marketplace. Your idea, your name, your work.',
		features: [
			{
				title: 'Hands-on until your bundle is live',
				description:
					'We work beside you while YOU build your Skillbundle — your product, your name, our infrastructure.'
			},
			{
				title: 'Selling in the aven Marketplace',
				description:
					'You sell your bundle yourself — your price, your customers, your name on the product.'
			},
			{
				title: 'Carefree billing',
				description:
					'We sell as the official merchant of record — app-store fees & co. are inside the 30 %, and you receive your payout weekly.'
			},
			{
				title: 'Sovereignty you hand on',
				description: 'Your customers keep their own keys — not you, not us.'
			},
			{
				title: 'Guidance through company formation',
				description: 'We walk you through Germany’s founding bureaucracy — GmbH or UG.'
			}
		]
	}
}

/**
 * A plan's texts in one language. DE reads straight off PLANS (the
 * originals); EN merges the translations over the feature list, so a feature
 * added before its translation lands still prints (in German) instead of
 * vanishing — the EN array is index-aligned with the plan's features.
 */
export function planTexts(id: PlanId, lang: PlanLang): PlanTexts {
	const p = plan(id)
	if (lang === 'de')
		return {
			role: p.role,
			pitch: p.pitch,
			features: p.features.map((f) => ({ title: f.title, description: f.description }))
		}
	const en = PLAN_TEXTS_EN[id]
	return {
		role: en.role,
		pitch: en.pitch,
		features: p.features.map(
			(f, i) => en.features[i] ?? { title: f.title, description: f.description }
		)
	}
}

/** A plan's feature lines flattened to their short titles, in the given language. */
export function featureLabels(id: PlanId, lang: PlanLang): string[] {
	return planTexts(id, lang).features.map((f) => f.title)
}
