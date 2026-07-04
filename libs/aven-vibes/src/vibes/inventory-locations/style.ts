import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// board 0112 — the inventory LOCATIONS grid: storage "bins" as brand tiles, each with an OCHRE spine (a
// thick left border, like a bin label) + the place name (Clash) + its item count. Its own loc-* namespace,
// visually distinct from the Planner's goals grid (which uses a navy top progress bar).
const tokens: StyleDef['tokens'] = {
	stock: '#b0803a' // the shared inventory ochre — ties the list + the locations grid together
}

const selectors: StyleDef['selectors'] = {
	'.loc-root': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.55rem',
		width: '100%',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em'
	},
	'.loc-eyebrow': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.4rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.09em',
		textTransform: 'uppercase',
		color: 'var(--muted)'
	},
	'.loc-eyebrow::before': { content: '"▦"', color: 'var(--stock)', fontSize: '0.9em', opacity: '0.9' },
	'.loc-meta': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', opacity: '0.7' },
	'.loc-grid': {
		display: 'grid',
		width: '100%',
		gridTemplateColumns: 'repeat(auto-fill, minmax(10.5rem, 1fr))',
		gap: '0.75rem'
	},
	// a bin tile: surface + border, with a thick ochre spine on the left (the "label edge").
	'.loc-card': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.3rem',
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderLeft: '3px solid var(--stock)',
		borderRadius: 'var(--radius-card)',
		padding: '0.9rem 1rem'
	},
	'.loc-name': {
		fontFamily: 'var(--font-display)',
		fontSize: 'var(--fs-title)',
		fontWeight: '500',
		color: 'var(--text)'
	},
	'.loc-count': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.3rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)',
		fontVariantNumeric: 'tabular-nums'
	},
	'.loc-count::before': { content: '"▪"', color: 'var(--stock)', fontSize: '0.8em', opacity: '0.85' },
	'.loc-empty': {
		border: '1px dashed var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1.1rem 1.25rem',
		textAlign: 'center',
		fontSize: 'var(--fs-body)',
		color: 'var(--muted)'
	},
	'.loc-empty:empty': { display: 'none' }
}

export const locationsStyle: StyleDef = withBrand({ tokens, selectors })
