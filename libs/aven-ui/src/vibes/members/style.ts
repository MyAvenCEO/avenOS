import type { StyleDef } from '../../engine/types.js'
import { withBrand } from '../../brand-style.js'

// Built on the shared brand layer (.brand-shell / .card / .eyebrow / .btn).
// Only the members-specific primitives — the access segmented control, the
// DID field, and the permission chips — are defined here.
const selectors: StyleDef['selectors'] = {
	'.mb-invite': {
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap)',
	},
	'.mb-did-field': {
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.625rem 1rem',
		color: 'var(--muted)',
		fontSize: 'var(--fs-body)',
	},
	'.mb-access-label': { marginTop: '0.25rem' },
	'.mb-segment': {
		display: 'flex',
		flexWrap: 'wrap',
		gap: 'var(--gap-tight)',
	},
	'.mb-pill': {
		borderRadius: 'var(--radius-pill)',
		border: '1px solid var(--border)',
		padding: '0.4rem 0.9rem',
		fontSize: 'var(--fs-body)',
		fontWeight: '500',
		color: 'var(--text)',
		background: 'transparent',
	},
	'.mb-pill--active': {
		background: 'var(--primary)',
		color: 'var(--primary-foreground)',
		borderColor: 'var(--primary)',
	},
	'.mb-hint': { fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: '1.5' },
	'.mb-grant': { alignSelf: 'flex-start', marginTop: '0.25rem' },
	'.mb-note': { fontSize: 'var(--fs-meta)', color: 'var(--muted)' },

	'.mb-entries': {
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap)',
	},
	'.mb-entry': {
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap-tight)',
	},
	'.mb-entry-head': {
		display: 'flex',
		alignItems: 'baseline',
		flexWrap: 'wrap',
		gap: '0.6rem',
	},
	'.mb-name': { fontSize: 'var(--fs-title)', fontWeight: '500', color: 'var(--text)' },
	'.mb-did': {
		fontFamily: 'var(--font-mono)',
		fontSize: 'var(--fs-meta)',
		color: 'var(--muted)',
		wordBreak: 'break-all',
	},
	'.mb-did:empty': { display: 'none' },
	'.mb-chips': {
		display: 'flex',
		flexWrap: 'wrap',
		gap: 'var(--gap-tight)',
		marginTop: '0.25rem',
	},
	'.mb-chip': {
		borderRadius: 'var(--radius-chip)',
		border: '1px solid var(--border-soft)',
		padding: '0.25rem 0.55rem',
		fontSize: '10px',
		fontWeight: '600',
		letterSpacing: '0.06em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
		background: 'var(--surface)',
	},
	'.mb-chip--on': {
		color: 'var(--primary)',
		borderColor: 'color-mix(in srgb, var(--primary) 30%, transparent)',
		background: 'color-mix(in srgb, var(--primary) 6%, transparent)',
	},
}

export const membersStyle: StyleDef = withBrand({ selectors })
