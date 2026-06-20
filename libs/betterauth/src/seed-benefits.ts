import { polarClient } from './auth'
import { TIERS } from './billing'

// Idempotent Polar benefit seeding — the pricing cards render 100% from these (Polar = SSOT).
// Matched by a STABLE key (metadata.skill for skills, metadata.key for display benefits) so
// re-runs UPDATE in place (rename-safe) and never duplicate. MINDS is derived in the UI from the
// live price, so it is NOT a benefit here. board 0052.
//
//   bun --env-file=../../.env.samuel src/seed-benefits.ts   (from libs/betterauth)

type Spec = {
	key: string
	type: 'custom' | 'feature_flag'
	description: string
	skill?: string
}

// Reusable benefit definitions. Edit here (or in the Polar dashboard) — the UI reflects Polar.
const BENEFITS: Spec[] = [
	{ key: 'gamepass', type: 'custom', description: 'avenCITY Gamepass' },
	{ key: 'avenname', type: 'custom', description: 'your own avenNAME' },
	{ key: 'website', type: 'feature_flag', description: 'websiteSKILL', skill: 'website' },
	{
		key: 'bookkeeping',
		type: 'feature_flag',
		description: 'bookkeepingSKILL',
		skill: 'bookkeeping'
	},
	{ key: 'blog', type: 'feature_flag', description: 'blogSKILL', skill: 'blog' },
	{
		key: 'vibecreator',
		type: 'feature_flag',
		description: 'vibecreatorSKILL',
		skill: 'vibecreator'
	}
]

// Per tier, the benefit keys to attach in display order (cumulative — each tier spells out its
// FULL set, no "everything in X"). updateBenefits replaces the product's set with exactly this.
const TIER_BENEFITS: Record<string, string[]> = {
	avenME: ['gamepass', 'avenname'],
	avenFOUNDER: ['gamepass', 'avenname', 'website', 'bookkeeping', 'blog'],
	avenCEO: ['gamepass', 'avenname', 'website', 'bookkeeping', 'blog', 'vibecreator']
}

type BenefitRow = {
	id: string
	description: string
	metadata?: Record<string, string | number | boolean>
}

async function main(): Promise<void> {
	if (!polarClient) {
		console.error('[seed] POLAR_API_KEY not set — cannot seed Polar benefits')
		process.exit(1)
	}
	const client = polarClient

	// Collect ALL existing benefits (so we update in place rather than duplicate).
	const existing: BenefitRow[] = []
	const pager = await client.benefits.list({ limit: 100 })
	for await (const page of pager) existing.push(...(page.result.items as BenefitRow[]))

	const find = (spec: Spec): BenefitRow | undefined =>
		spec.skill
			? existing.find((b) => b.metadata?.skill === spec.skill)
			: existing.find((b) => b.metadata?.key === spec.key)

	const idByKey: Record<string, string> = {}
	for (const spec of BENEFITS) {
		const metadata: Record<string, string> = { key: spec.key }
		if (spec.skill) metadata.skill = spec.skill
		const found = find(spec)
		const create =
			spec.type === 'feature_flag'
				? { type: 'feature_flag' as const, description: spec.description, metadata, properties: {} }
				: {
						type: 'custom' as const,
						description: spec.description,
						metadata,
						properties: { note: null }
					}
		const benefit = found
			? await client.benefits.update({ id: found.id, requestBody: create })
			: await client.benefits.create(create)
		idByKey[spec.key] = benefit.id
		console.log(
			`[seed] ${found ? 'updated' : 'created'} ${spec.key} → "${spec.description}" (${benefit.id})`
		)
	}

	for (const [tier, keys] of Object.entries(TIER_BENEFITS)) {
		const productId = TIERS[tier]?.productId
		if (!productId) {
			console.warn(`[seed] no product id for tier ${tier} — skipped`)
			continue
		}
		const benefits = keys.map((k) => idByKey[k]).filter((id): id is string => Boolean(id))
		await client.products.updateBenefits({ id: productId, productBenefitsUpdate: { benefits } })
		console.log(`[seed] ${tier}: attached [${keys.join(', ')}]`)
	}

	console.log('[seed] done')
	process.exit(0)
}

void main()
