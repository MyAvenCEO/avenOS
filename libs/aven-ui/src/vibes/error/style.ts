import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// Shared brand layer provides colours/radii/fonts/ink. Error keeps its accent.
const tokens: StyleDef['tokens'] = {
	accent: '#b3261e'
}

const selectors: StyleDef['selectors'] = {
	'*, *::before, *::after': { boxSizing: 'border-box' },
	':host': {
		fontFamily: 'var(--font-sans)',
		background: 'var(--bg-a)',
		color: 'var(--text)',
		margin: '0',
		minHeight: '100%',
		height: '100%'
	},
	'.st-panel': {
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap-tight)',
		overflow: 'hidden',
		borderRadius: 'var(--radius-card)',
		border: '1px solid var(--border)',
		background: 'var(--surface)',
		padding: 'var(--pad-card)',
		maxWidth: 'var(--max-w)',
		margin: '0 auto'
	},
	'.st-badge': {
		display: 'inline-flex',
		alignItems: 'center',
		borderRadius: '9999px',
		border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
		background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
		padding: '2px 8px',
		fontSize: 'var(--fs-micro)',
		fontWeight: '500',
		letterSpacing: '0.18em',
		textTransform: 'uppercase',
		color: 'var(--accent)'
	},
	'.st-eyebrow': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.22em',
		textTransform: 'uppercase',
		opacity: '0.4'
	},
	'.st-title': {
		margin: '2px 0 0',
		fontSize: 'var(--fs-lead)',
		lineHeight: '1.35',
		fontWeight: '500',
		color: 'var(--text)'
	},
	'.st-message': { fontSize: 'var(--fs-meta)', lineHeight: '1.6', color: 'var(--accent)' },
	'.st-message-label': { fontWeight: '500', marginRight: '6px' },
	'.st-message-text': { whiteSpace: 'pre-line' },
	'.st-message-text:empty': { display: 'none' }
}

export const errorStyle: StyleDef = withBrand({ tokens, selectors })
