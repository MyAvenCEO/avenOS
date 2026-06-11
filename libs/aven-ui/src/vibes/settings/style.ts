import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

const selectors: StyleDef['selectors'] = {
	'.set-title': {
		margin: '0',
		fontSize: 'var(--fs-hero)',
		fontWeight: '500',
		letterSpacing: 'var(--tracking-tight)'
	},
	'.set-section': { display: 'flex', flexDirection: 'column', gap: 'var(--gap-tight)' },
	'.set-section-label': { paddingLeft: '0.25rem' },

	/* The group card holds rows; the card primitive supplies bg/border/radius.
	 * Override padding to 0 so rows can own their own dividers edge-to-edge. */
	'.set-group': { padding: '0' },
	'.set-row': {
		display: 'flex',
		alignItems: 'baseline',
		justifyContent: 'space-between',
		gap: 'var(--gap)',
		padding: '0.875rem var(--pad-card)',
		borderBottom: '1px solid var(--border-soft)'
	},
	'.set-row:last-child': { borderBottom: 'none' },
	'.set-row-main': { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0' },
	'.set-label': { fontSize: 'var(--fs-title)', fontWeight: '500', color: 'var(--text)' },
	'.set-hint': { fontSize: 'var(--fs-meta)', color: 'var(--muted)', lineHeight: '1.45' },
	'.set-hint:empty': { display: 'none' },
	'.set-value': {
		flexShrink: '0',
		fontSize: 'var(--fs-body)',
		fontFamily: 'var(--font-mono)',
		color: 'var(--muted-strong)',
		textAlign: 'right'
	}
}

export const settingsStyle: StyleDef = withBrand({ selectors })
