/**
 * The English face of the pricing SSOT, applied at render time. The TEXTS —
 * German originals and their English translations — live in the brand
 * package (`@avenos/aven-brand/pricing`, re-exported via `$lib/pricing/plans`)
 * so the id service seeds its Polar products from the same words; this file
 * keeps only the render-time adapters: ids, prices and skill slugs never
 * change, only the words around them. German delegates to the original
 * helpers so both languages print exactly the same thing on the German site.
 */

import {
	ctaLabel as ctaLabelDe,
	euro,
	type Plan,
	perLabel as perLabelDe,
	planTexts,
	priceLabel as priceLabelDe,
	priceSuffix as priceSuffixDe,
	VAT_NOTE
} from '$lib/pricing/plans'
import type { Lang } from './index'

/** The plan with `role`, `pitch` and every feature's title/subline in the
 * reader's language — DE is the original; skill slugs and hrefs never change. */
export function localizedPlan(p: Plan, lang: Lang): Plan {
	if (lang === 'de') return p
	const en = planTexts(p.id, 'en')
	return {
		...p,
		role: en.role,
		pitch: en.pitch,
		features: p.features.map((f, i) => ({ ...f, ...(en.features[i] ?? {}) }))
	}
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
