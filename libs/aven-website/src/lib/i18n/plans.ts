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

/** Per plan: the role line and the feature labels, in feature order. */
const EN: Record<PlanId, { role: string; features: string[] }> = {
	avenid: {
		role: 'Your name — one account anyone can address. Per person and per company.',
		features: [
			'Your avenID name — reserved for you for 1 year',
			'Your place on the waiting list',
			'20 min of trial access — the moment you are invited',
			'Required for avenME and avenFOUNDER — one per person, one per company',
			'5 % commission on every aven product you refer — monthly, for as long as it runs'
		]
	},
	avenme: {
		role: 'Your personal AI‑CEO — for your life',
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
		features: [
			'Pre-accounting',
			'Finance dashboard and invoices',
			'Agent API auth proxy',
			'Website and landing pages',
			'Product checkout and shop',
			'Blog',
			'Digital mailbox for business customers (excl. Deutsche Post mail forwarding: 51.90 € / 6 months, incl. VAT)',
			'The memory of your company: knowledge and experience accumulate in the avenCEO over the years — that becomes your most valuable asset'
		]
	},
	avencoop: {
		role: 'We become your technical co-founder',
		features: [
			'1× avenFOUNDER — the avenCEO of your company — included',
			'We actively build your product with you — effectively your external CTO and co-founder',
			'Guidance through German company formation: GmbH or UG',
			'You choose which avenCOOPs your Reinvest flows into — our avenCEO GmbH is on the ballot too',
			'We lead your beel syndicate — with community investments from your supporters'
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

/** "25 € one-time" · "426 €/month" */
export function priceLabel(p: Plan, lang: Lang): string {
	if (lang === 'de') return priceLabelDe(p)
	return p.billing === 'once' ? `${euro(p.eurPrice)} € one-time` : `${euro(p.eurPrice)} €/month`
}

export function vatNote(lang: Lang): string {
	return lang === 'de' ? VAT_NOTE : 'All prices include statutory VAT.'
}

/** "per person" · "per company" */
export function perLabel(p: Plan, lang: Lang): string | null {
	if (lang === 'de') return perLabelDe(p)
	if (p.per === 'person') return 'per person'
	if (p.per === 'company') return 'per company'
	return null
}

/** Book it, or apply for it. */
export function ctaLabel(p: Plan, lang: Lang): string {
	if (lang === 'de') return ctaLabelDe(p)
	if (p.applyOnly) return 'Apply'
	return p.id === 'avenid' ? 'Claim avenID' : 'Reserve your name now'
}
