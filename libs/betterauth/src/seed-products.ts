import { polarClient } from './auth'
import { setTierProductId, TIER_PRODUCTS } from './billing'

// Idempotent Polar PRODUCT seeding — creates the tier products (avenME/avenFOUNDER/avenCEO) from
// TIER_PRODUCTS config in whatever org the POLAR_API_KEY points at, matched by a STABLE
// `metadata.tier` so re-runs reuse (never duplicate). This is what lets a FRESH sandbox/production
// org bootstrap from config alone — no product ids to copy around. Pair it with seed-benefits.ts
// (which calls this first) to attach benefits, and refreshTierProducts() (billing.ts) discovers the
// resulting ids at boot. board 0062.
//
//   bun --env-file=../../.env.samuel src/seed-products.ts   (from libs/betterauth)

type ProductRow = {
	id: string
	name?: string
	isArchived?: boolean
	metadata?: Record<string, unknown>
}

/**
 * Ensure each tier's Polar product exists in the configured org. Missing products are CREATED from
 * TIER_PRODUCTS (name + weekly EUR price + `metadata.tier`); existing ones (matched by metadata.tier)
 * are reused. Updates the in-process tier→id map so a follow-up benefit seed attaches to the right
 * products. Safe to re-run. Returns the resolved tier→productId map.
 */
export async function seedProducts(): Promise<Record<string, string>> {
	if (!polarClient) {
		console.error('[seed] POLAR_API_KEY not set — cannot seed products')
		return {}
	}
	const client = polarClient

	// All existing products (so we reuse rather than duplicate on re-run).
	const existing: ProductRow[] = []
	const pager = await client.products.list({ limit: 100 })
	for await (const page of pager) existing.push(...(page.result.items as ProductRow[]))

	const resolved: Record<string, string> = {}
	for (const [tier, cfg] of Object.entries(TIER_PRODUCTS)) {
		const found = existing.find((p) => !p.isArchived && p.metadata?.tier === tier)
		if (found) {
			setTierProductId(tier, found.id)
			resolved[tier] = found.id
			console.log(`[seed] product ${tier}: reuse ${found.id} ("${found.name ?? cfg.name}")`)
			continue
		}
		const created = await client.products.create({
			name: cfg.name,
			recurringInterval: 'week',
			prices: [{ amountType: 'fixed', priceCurrency: 'eur', priceAmount: cfg.priceCents }],
			metadata: { tier }
		})
		setTierProductId(tier, created.id)
		resolved[tier] = created.id
		console.log(
			`[seed] product ${tier}: CREATED ${created.id} (€${(cfg.priceCents / 100).toFixed(2)}/wk)`
		)
	}
	console.log('[seed] products done')
	return resolved
}

// Run standalone with `bun src/seed-products.ts`; importing it (e.g. from seed-benefits.ts) does NOT
// auto-run.
if (import.meta.main) {
	void seedProducts()
		.then(() => process.exit(0))
		.catch((e) => {
			console.error('[seed] products failed:', e)
			process.exit(1)
		})
}
