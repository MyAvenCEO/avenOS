// The products that exist at the provider, straight from the brand's
// pricing SSOT. The tier IS the wire key: it lands in the Polar product's
// `metadata.tier` and is how products are found again — never pinned ids.
import { PLANS, type Plan } from '@avenos/aven-brand/pricing'
import type { ProductSeed } from './provider.js'

/** Every provider product: the one-off avenID plus the recurring tiers.
 * avenCOOP is not a product at all — that relationship is handled
 * individually, outside this system. */
export const PRODUCT_TIERS = ['avenid', 'avenme', 'avenceo'] as const

export function productSeeds(): ProductSeed[] {
	return PRODUCT_TIERS.map((tier) => {
		// biome-ignore lint/style/noNonNullAssertion: PRODUCT_TIERS ⊂ PLANS ids.
		const plan: Plan = PLANS.find((p) => p.id === tier)!
		return {
			tier,
			name: plan.name,
			description: plan.role,
			// GROSS cents — Polar presents the price tax-INCLUSIVE ("inkl. USt."),
			// so the SSOT number is exactly what the buyer pays.
			priceCents: Math.round(plan.eurPrice * 100),
			interval: plan.billing === 'monthly' ? 'month' : null
		}
	})
}
