import {
	brandBaseSelectors,
	brandTokens,
	cardStyle,
	goalsStyle,
	inventoryStyle,
	locationsStyle,
	todoStyle
} from '@avenos/aven-vibes'
import { type Kysely, sql } from 'kysely'

// board 0115 — the BRAND layer becomes its own referenced vibe_style row (Samuel: "shouldn't brand
// styling be another dynamic style, reused via ref on the fly?"). Until now withBrand() BAKED a full
// copy of the brand tokens+selectors into every style row (~15 duplicates; a brand change meant
// re-seeding everything). Now: ONE `brand` row + every style row stored RAW with `extends: 'brand'`,
// composed base-under-own at SERVE time (vibe-registry.composeStyle) — edit the brand row and every
// extending vibe re-styles on its next load. The TS constants remain the SEED source only.

const BRAND_STYLE = { tokens: brandTokens, selectors: brandBaseSelectors }

// the shared card style is seeded under many names (created/edited/deleted/ontology/query/mutation/bundle).
const CARD_STYLE_NAMES = [
	'bundle-created',
	'ontology',
	'ontology-created',
	'query-result',
	'mutation-result',
	'todos-created',
	'todos-edited',
	'todos-deleted'
]

// the mockups list-grid style, RAW (0089 seeded it baked; this unbakes it).
const MOCKUPS_STYLE_RAW = {
	extends: 'brand',
	tokens: {},
	selectors: {
		'.mk-root': {
			display: 'flex',
			flexDirection: 'column',
			gap: '0.55rem',
			width: '100%',
			fontFamily: 'var(--font-sans)',
			color: 'var(--text)',
			letterSpacing: '-0.02em'
		},
		'.mk-eyebrow': {
			display: 'inline-flex',
			alignItems: 'center',
			gap: '0.4rem',
			fontSize: 'var(--fs-micro)',
			fontWeight: '600',
			letterSpacing: '0.09em',
			textTransform: 'uppercase',
			color: 'var(--muted)'
		},
		'.mk-eyebrow::before': { content: '"◇"', color: 'var(--brand-accent)', fontSize: '0.9em' },
		'.mk-meta': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', opacity: '0.7' },
		'.mk-grid': {
			display: 'grid',
			width: '100%',
			gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
			gap: '0.75rem'
		},
		'.mk-name': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontFamily: 'var(--font-sans)' },
		'.mk-empty': {
			border: '1px dashed var(--border)',
			borderRadius: 'var(--radius-card)',
			padding: '1.1rem 1.25rem',
			textAlign: 'center',
			fontSize: 'var(--fs-body)',
			color: 'var(--muted)'
		},
		'.mk-empty:empty': { display: 'none' }
	}
}

async function reseed(db: Kysely<unknown>, name: string, value: unknown): Promise<void> {
	await sql`
		INSERT INTO vibe_style (name, body) VALUES (${name}, ${JSON.stringify(value)}::jsonb)
		ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
	`.execute(db)
}

export async function up(db: Kysely<unknown>): Promise<void> {
	await reseed(db, 'brand', BRAND_STYLE)
	// the TS SSOTs are now RAW (+ extends:'brand') — re-seed every row that used to be baked.
	await reseed(db, 'goals', goalsStyle)
	await reseed(db, 'inventory', inventoryStyle)
	await reseed(db, 'inventory-locations', locationsStyle)
	await reseed(db, 'todos', todoStyle)
	for (const name of CARD_STYLE_NAMES) await reseed(db, name, cardStyle)
	await reseed(db, 'mockups', MOCKUPS_STYLE_RAW)
	// existing minted mock-* styles keep their baked copy (still valid); new mints store raw refs.
}

export async function down(): Promise<void> {
	// non-destructive: the previous style migrations re-seed baked copies if ever needed.
}
