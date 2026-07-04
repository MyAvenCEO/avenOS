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
		width: '100%',
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
		width: '100%',
		gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
		gap: '0.75rem'
	},
	'.gl-count': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)',
		fontVariantNumeric: 'tabular-nums'
	},
	// board 0112 — the done/total PROGRESS BAR. The sandbox forbids inline styles, so the fill width is a
	// DISCRETE class (p0…p100, rounded to 10s by the logic) — pure config, validator-safe.
	'.gl-bar': {
		height: '0.375rem',
		borderRadius: 'var(--radius-pill)',
		background: 'color-mix(in srgb, var(--brand-accent) 10%, transparent)',
		overflow: 'hidden',
		marginTop: '0.35rem'
	},
	'.gl-bar-fill': {
		height: '100%',
		borderRadius: 'var(--radius-pill)',
		background: 'var(--brand-accent)',
		transition: 'width 0.25s ease'
	},
	'.gl-bar-fill.p0': { width: '0%' },
	'.gl-bar-fill.p10': { width: '10%' },
	'.gl-bar-fill.p20': { width: '20%' },
	'.gl-bar-fill.p30': { width: '30%' },
	'.gl-bar-fill.p40': { width: '40%' },
	'.gl-bar-fill.p50': { width: '50%' },
	'.gl-bar-fill.p60': { width: '60%' },
	'.gl-bar-fill.p70': { width: '70%' },
	'.gl-bar-fill.p80': { width: '80%' },
	'.gl-bar-fill.p90': { width: '90%' },
	'.gl-bar-fill.p100': { width: '100%' },
	'.gl-empty': {
		border: '1px dashed var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1.1rem 1.25rem',
		textAlign: 'center',
		fontSize: 'var(--fs-body)',
		color: 'var(--muted)'
	},
	'.gl-empty:empty': { display: 'none' },
	// board 0114 — the LIVING @container example (the default vibe capability: the engine puts
	// inline-size containment on the view root): in a narrow container the grid tightens its tracks so
	// two tiles still fit side by side instead of stacking.
	'@container (max-width: 420px)': {
		'.gl-grid': { gridTemplateColumns: 'repeat(auto-fill, minmax(8.5rem, 1fr))', gap: '0.5rem' }
	}
}

export const goalsStyle: StyleDef = withBrand({ tokens: {}, selectors })
