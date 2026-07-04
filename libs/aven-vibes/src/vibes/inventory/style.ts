import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// board 0112 — the INVENTORY list vibe: a bespoke "stock ledger" in its OWN inv-* namespace (not the
// shared card classes), so it reads as its own little app. Signature = an OCHRE "stock" accent (distinct
// from the Planner's navy goals and the todos priority tones) + each row ending in a bold quantity badge
// with a location tag. Composed on the brand layer (Azeret body, Clash titles, brand surface/border).
const tokens: StyleDef['tokens'] = {
	stock: '#b0803a', // ochre — the inventory signature tone ("goods / warehouse")
	'row-divider': 'color-mix(in srgb, var(--border) 55%, transparent)'
}

const selectors: StyleDef['selectors'] = {
	'.inv-root': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.55rem',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em'
	},
	'.inv-head': {
		display: 'flex',
		alignItems: 'baseline',
		justifyContent: 'space-between',
		gap: '0.75rem'
	},
	'.inv-eyebrow': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.4rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.09em',
		textTransform: 'uppercase',
		color: 'var(--muted)'
	},
	'.inv-eyebrow::before': { content: '"▪"', color: 'var(--stock)', fontSize: '0.85em' },
	'.inv-meta': {
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted)',
		opacity: '0.7',
		fontVariantNumeric: 'tabular-nums'
	},
	// the ledger: one bordered surface, hairline divider rows.
	'.inv-list': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		overflow: 'hidden'
	},
	'.inv-row': {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'space-between',
		gap: '0.75rem',
		padding: '0.7rem 0.95rem',
		borderTop: '1px solid var(--row-divider)'
	},
	'.inv-row:first-child': { borderTop: 'none' },
	'.inv-name': {
		fontSize: 'var(--fs-body)',
		fontWeight: '500',
		color: 'var(--text)',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis'
	},
	'.inv-right': { display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexShrink: '0' },
	// location tag — a soft ochre-tinted chip with a ▪ bin marker.
	'.inv-loc': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.3rem',
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted-strong)',
		background: 'color-mix(in srgb, var(--stock) 6%, transparent)',
		border: '1px solid color-mix(in srgb, var(--stock) 20%, transparent)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.12rem 0.55rem',
		whiteSpace: 'nowrap'
	},
	'.inv-loc:empty': { display: 'none' },
	'.inv-loc::before': { content: '"▪"', color: 'var(--stock)', fontSize: '0.8em', opacity: '0.85' },
	// the quantity badge — bold, tabular, ochre — the ledger's signature "stock count".
	'.inv-qty': {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		minWidth: '2.4rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '700',
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--stock)',
		background: 'color-mix(in srgb, var(--stock) 13%, transparent)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.16rem 0.6rem'
	},
	'.inv-empty': {
		border: '1px dashed var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1.1rem 1.25rem',
		textAlign: 'center',
		fontSize: 'var(--fs-body)',
		color: 'var(--muted)'
	},
	'.inv-empty:empty': { display: 'none' }
}

export const inventoryStyle: StyleDef = withBrand({ tokens, selectors })
