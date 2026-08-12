import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

const selectors: StyleDef['selectors'] = {
	'.ch-title': {
		margin: '0',
		fontSize: 'var(--fs-hero)',
		fontWeight: '500',
		letterSpacing: 'var(--tracking-tight)'
	},
	'.ch-subtitle': { marginTop: '0.25rem', fontSize: 'var(--fs-body)', color: 'var(--muted)' },
	'.ch-thread': { display: 'flex', flexDirection: 'column', gap: 'var(--gap-section)' },

	'.ch-row': {
		display: 'flex',
		flexDirection: 'column',
		gap: '4px',
		maxWidth: '80%',
		alignItems: 'flex-start'
	},
	'.ch-row--own': { alignSelf: 'flex-end', alignItems: 'flex-end' },

	'.ch-meta': {
		display: 'flex',
		alignItems: 'baseline',
		gap: '0.5rem',
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted)',
		padding: '0 0.25rem'
	},
	'.ch-author': { fontWeight: '600', color: 'var(--muted-strong)' },
	'.ch-row--agent .ch-author': { color: 'var(--primary)' },

	'.ch-bubble': {
		fontSize: 'var(--fs-body)',
		lineHeight: '1.55',
		borderRadius: 'var(--radius-card)',
		padding: 'var(--pad-card-sm)',
		whiteSpace: 'pre-line',
		border: '1px solid var(--border)',
		background: 'var(--surface)',
		color: 'var(--text)'
	},
	'.ch-bubble--own': {
		background: 'var(--primary)',
		color: 'var(--primary-foreground)',
		borderColor: 'var(--primary)',
		borderBottomRightRadius: 'var(--radius-chip)'
	},
	'.ch-bubble--agent': {
		borderBottomLeftRadius: 'var(--radius-chip)',
		boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--primary) 12%, transparent)'
	}
}

export const chatStyle: StyleDef = withBrand({ selectors })
