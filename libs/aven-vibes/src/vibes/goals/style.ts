import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// board 0112 — the GOALS grid card: every goal the user's todos cluster under, as a responsive grid of
// brand tiles (the docs-landing .grid-card pattern — icon-free: ✳ eyebrow + Clash name + task count).
// Composed on the brand layer; the .grid-card/.grid-card-title primitives come from brandBaseSelectors.
const selectors: StyleDef['selectors'] = {
	'.gl-root': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.55rem',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em'
	},
	'.gl-eyebrow': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.4rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.08em',
		textTransform: 'uppercase',
		color: 'var(--muted)'
	},
	'.gl-eyebrow::before': {
		content: '"✳"',
		fontSize: '0.9em',
		lineHeight: '1',
		color: 'var(--brand-accent)',
		opacity: '0.85'
	},
	'.gl-meta': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', opacity: '0.7' },
	'.gl-grid': {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
		gap: '0.75rem'
	},
	'.gl-count': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)',
		fontVariantNumeric: 'tabular-nums'
	},
	'.gl-empty': {
		border: '1px dashed var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1.1rem 1.25rem',
		textAlign: 'center',
		fontSize: 'var(--fs-body)',
		color: 'var(--muted)'
	},
	'.gl-empty:empty': { display: 'none' }
}

export const goalsStyle: StyleDef = withBrand({ tokens: {}, selectors })
