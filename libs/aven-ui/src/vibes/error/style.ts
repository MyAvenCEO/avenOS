import type { StyleDef } from '../../engine/types.js'

const tokens: StyleDef['tokens'] = {
	'bg-a': '#FBFAF6',
	'tech-fill': 'rgba(255, 255, 255, 0.1)',
	border: 'rgba(0, 0, 0, 0.1)',
	muted: 'rgba(26, 26, 26, 0.45)',
	text: '#1a1a1a',
	accent: '#b3261e',
	'radius-2xl': '2rem',
	'font-sans': "'Chillax', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

const selectors: StyleDef['selectors'] = {
	'*, *::before, *::after': { boxSizing: 'border-box' },
	':host': {
		fontFamily: 'var(--font-sans)',
		background: 'var(--bg-a)',
		color: 'var(--text)',
		margin: '0',
		minHeight: '100%',
		height: '100%',
	},
	'.st-panel': {
		display: 'flex',
		flexDirection: 'column',
		gap: '8px',
		overflow: 'hidden',
		borderRadius: 'var(--radius-2xl)',
		border: '2px dotted color-mix(in srgb, var(--border) 40%, transparent)',
		background: 'var(--tech-fill)',
		padding: '12px 14px',
	},
	'.st-badge': {
		display: 'inline-flex',
		alignItems: 'center',
		borderRadius: '9999px',
		border: '1px solid color-mix(in srgb, var(--accent) 40%, transparent)',
		background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
		padding: '2px 8px',
		fontSize: '9px',
		fontWeight: '500',
		letterSpacing: '0.18em',
		textTransform: 'uppercase',
		color: 'var(--accent)',
	},
	'.st-eyebrow': {
		fontSize: '8px',
		fontWeight: '600',
		letterSpacing: '0.22em',
		textTransform: 'uppercase',
		opacity: '0.4',
	},
	'.st-title': {
		margin: '2px 0 0',
		fontSize: '1rem',
		lineHeight: '1.35',
		fontWeight: '500',
		color: 'var(--text)',
	},
	'.st-message': { fontSize: '12px', lineHeight: '1.6', color: 'var(--accent)' },
	'.st-message-label': { fontWeight: '500', marginRight: '6px' },
	'.st-message-text': { whiteSpace: 'pre-line' },
	'.st-message-text:empty': { display: 'none' },
}

export const errorStyle: StyleDef = {
	tokens,
	selectors,
}
