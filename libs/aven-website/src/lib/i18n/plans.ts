/**
 * The English face of the pricing SSOT. plans-data.ts stays German — the id
 * service seeds its products from it — so the translation lives here and is
 * applied at render time: ids, prices and skill slugs never change, only the
 * words around them. German delegates to the original helpers so both
 * languages print exactly the same thing on the German site.
 */

import {
	ctaLabel as ctaLabelDe,
	euro,
	type Plan,
	type PlanFeature,
	type PlanId,
	perLabel as perLabelDe,
	priceLabel as priceLabelDe,
	priceSuffix as priceSuffixDe,
	VAT_NOTE
} from '$lib/pricing/plans'
import type { Lang } from './index'

/** Per plan: the role line, the pitch, and the feature labels, in feature order. */
const EN: Record<PlanId, { role: string; pitch: string; features: string[] }> = {
	avenid: {
		role: 'Your name — one account anyone can address. Per human and per company.',
		pitch:
			'Your name is the first step into a life where AI works for you — not for a corporation. It exists exactly once. Claim it before someone else carries it.',
		features: [
			'Your avenID name — reserved for you for 1 year',
			'Your place on the waiting list',
			'20 min of trial access — the moment you are invited',
			'Required for avenME and avenFOUNDER — one per human, one per company'
		]
	},
	avenme: {
		role: 'Your personal AI‑CEO — for your life',
		pitch:
			'Your life is full of ideas, appointments, projects and open threads — your avenME holds it all together. It coordinates your day, catches every thought and turns loose concepts into things that happen.',
		features: [
			'Personal live organisation: tasks, appointments, reminders',
			'One inbox for everything',
			'Email inbox',
			'Digital mailbox — your paper mail digitised (excl. Deutsche Post mail forwarding: 31.90 € / 6 months, incl. VAT)',
			'Document management',
			'Notes, contacts, relationships',
			'You decide when it counts',
			'Your calendar thinks ahead',
			'Your list sorts itself',
			'Links and bookmarks, findable again',
			'Your personal knowledge base — everything you learn stays with your Aven',
			'Trains the avenCEO of your company together with you'
		]
	},
	avenceo: {
		role: 'Your professional AI‑CEO — for your company',
		pitch:
			'You bring the vision — your avenFOUNDER turns it into a company that runs. It works while you sleep and gets better every day. This is what founding feels like when it no longer costs an 80-hour week.',
		features: [
			'Pre-accounting',
			'Finance dashboard and invoices',
			'Agent API auth proxy',
			'Website and landing pages',
			'Product checkout and shop',
			'Blog',
			'Digital mailbox for business customers (excl. Deutsche Post mail forwarding: 51.90 € / 6 months, incl. VAT)',
			'Listed in the aven Marketplace — findable by customers, partners and other Avens',
			'The memory of your company: knowledge and experience accumulate in the avenCEO over the years — that becomes your most valuable asset'
		]
	},
	avencoop: {
		role: 'Hands-on support for your own sovereign Aven business',
		pitch:
			'You do not just want a company — you want your own Aven business. We built the infrastructure and stand beside you until your Skillbundle is live in the Marketplace. Your idea, your name, your work.',
		features: [
			'Hands-on support while YOU build your Skillbundle — your product, your name, our infrastructure',
			'You sell it yourself in the aven Marketplace — your bundle, your price, your customers',
			'Carefree billing: we sell as the official merchant of record — app-store fees & co. are inside the 30 %, and you receive your payout weekly',
			'Sovereignty you hand on: your customers keep their own keys — not you, not us',
			'Guidance through German company formation: GmbH or UG'
		]
	}
}

function relabel(f: PlanFeature, label: string): PlanFeature {
	if (typeof f === 'string') return label
	return { ...f, label }
}

/** The plan with `role` and `features` in the reader's language — DE is the original. */
export function localizedPlan(p: Plan, lang: Lang): Plan {
	if (lang === 'de') return p
	const en = EN[p.id]
	return {
		...p,
		role: en.role,
		pitch: en.pitch,
		features: p.features.map((f, i) => relabel(f, en.features[i] ?? featureLabel(f)))
	}
}

function featureLabel(f: PlanFeature): string {
	return typeof f === 'string' ? f : f.label
}

/** "/month · incl. VAT" · "one-time · incl. VAT" */
export function priceSuffix(p: Plan, lang: Lang): string {
	if (lang === 'de') return priceSuffixDe(p)
	return p.billing === 'once' ? 'one-time · incl. VAT' : '/month · incl. VAT'
}

/** "25 € one-time" · "377 €/month" */
export function priceLabel(p: Plan, lang: Lang): string {
	if (lang === 'de') return priceLabelDe(p)
	return p.billing === 'once' ? `${euro(p.eurPrice)} € one-time` : `${euro(p.eurPrice)} €/month`
}

/** The share note in the reader's language — the DE string lives in plans-data. */
export function shareNote(p: Plan, lang: Lang): string | null {
	if (!p.revenueShareNote) return null
	return lang === 'de' ? p.revenueShareNote : 'incl. app-store fees & co.'
}

/** A euro amount in the reader's number style — "188,50" vs "188.50". */
export function money(amount: number, lang: Lang): string {
	if (lang === 'de') return euro(amount)
	const cents = Number.isInteger(amount) ? 0 : 2
	return amount.toLocaleString('en-US', {
		minimumFractionDigits: cents,
		maximumFractionDigits: cents
	})
}

export function vatNote(lang: Lang): string {
	return lang === 'de' ? VAT_NOTE : 'All prices include statutory VAT.'
}

/** "per human" · "per company" */
export function perLabel(p: Plan, lang: Lang): string | null {
	if (lang === 'de') return perLabelDe(p)
	if (p.per === 'person') return 'per human'
	if (p.per === 'company') return 'per company'
	return null
}

/** Book it, or apply for it. */
export function ctaLabel(p: Plan, lang: Lang): string {
	if (lang === 'de') return ctaLabelDe(p)
	if (p.applyOnly) return 'Apply'
	return p.id === 'avenid' ? 'Claim avenID' : 'Join the waiting list'
}
