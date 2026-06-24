import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// Shared styling for the generic structured-document view. Brand layer + a clean sections/cards/
// table layout (the legacy invoice/bank/contract layouts, unified under one cleaner design). 0064.
const selectors: StyleDef['selectors'] = {
	'.doc-view': {
		minHeight: '100%',
		width: '100%',
		boxSizing: 'border-box',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.01em',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.75rem'
	},
	'.doc-title': {
		margin: '0',
		fontSize: 'var(--fs-title)',
		fontWeight: '600',
		lineHeight: '1.2',
		letterSpacing: '-0.02em',
		color: 'var(--text)'
	},
	'.doc-subtitle': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		color: 'var(--muted)',
		opacity: '0.7'
	},
	'.doc-sections': {
		display: 'flex',
		flexDirection: 'column',
		gap: '1rem'
	},
	'.doc-section': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.4rem'
	},
	'.doc-section-title': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		color: 'var(--muted)'
	},
	'.doc-cards': {
		display: 'grid',
		gridTemplateColumns: '1fr 1fr',
		gap: '0.6rem'
	},
	'.doc-card': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '0.7rem 0.8rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.15rem'
	},
	'.doc-card-title': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		color: 'var(--muted)'
	},
	'.doc-card-name': {
		fontSize: 'var(--fs-body)',
		fontWeight: '600',
		color: 'var(--text)',
		lineHeight: '1.3',
		marginBottom: '0.2rem'
	},
	'.doc-card-line': {
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted)',
		lineHeight: '1.45'
	},
	'.doc-kv': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.15rem'
	},
	'.doc-kv-row': {
		display: 'flex',
		justifyContent: 'space-between',
		gap: '1rem',
		fontSize: 'var(--fs-body)',
		lineHeight: '1.5',
		borderBottom: '1px solid var(--border)',
		padding: '0.2rem 0'
	},
	'.doc-kv-k': {
		color: 'var(--muted)',
		flexShrink: '0'
	},
	'.doc-kv-v': {
		color: 'var(--text)',
		fontWeight: '500',
		textAlign: 'right'
	},
	'.doc-table': {
		width: '100%',
		fontSize: 'var(--fs-micro)',
		color: 'var(--text)'
	},
	'.doc-th': {
		textAlign: 'left',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.04em',
		padding: '0.3rem 0.4rem',
		borderBottom: '1px solid var(--border)'
	},
	'.doc-td': {
		textAlign: 'left',
		padding: '0.3rem 0.4rem',
		borderBottom: '1px solid var(--border)',
		color: 'var(--text)'
	},
	'.doc-num': {
		textAlign: 'right'
	},
	'@media (max-width: 600px)': {
		'.doc-cards': { gridTemplateColumns: '1fr' }
	}
}

export const docStyle: StyleDef = withBrand({ selectors })
