import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

const tokens: StyleDef['tokens'] = {
	'chip-invoice': '#1e40af',
	'chip-invoice-fg': '#dbeafe',
	'chip-bank': '#166534',
	'chip-bank-fg': '#dcfce7',
	'chip-contract': '#92400e',
	'chip-contract-fg': '#fef3c7',
	'chip-other': '#374151',
	'chip-other-fg': '#f3f4f6'
}

const selectors: StyleDef['selectors'] = {
	'.bk-shell': {
		minHeight: '100%',
		width: '100%',
		boxSizing: 'border-box',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em',
		display: 'flex',
		flexDirection: 'column'
	},
	'.bk-layout': {
		display: 'grid',
		gridTemplateColumns: '60fr 40fr',
		gap: '1rem',
		minHeight: '0',
		flex: '1'
	},
	// Left: document preview
	'.bk-preview': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		overflow: 'hidden',
		display: 'flex',
		flexDirection: 'column'
	},
	'.bk-preview-inner': {
		flex: '1',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		overflow: 'hidden',
		minHeight: '200px'
	},
	// Visibility is driven by state classes computed in logic.js (.bk-hidden) — NOT attribute
	// selectors, which the engine forbids (CSS [attr] selectors can exfiltrate values). 0063.
	'.bk-img': {
		width: '100%',
		maxHeight: '100%',
		objectFit: 'contain',
		display: 'block'
	},
	'.bk-no-preview': {
		color: 'var(--muted)',
		fontSize: 'var(--fs-body)',
		padding: '2rem',
		textAlign: 'center',
		width: '100%'
	},
	'.bk-hidden': {
		display: 'none'
	},
	// Right: metadata
	'.bk-meta': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.6rem'
	},
	'.bk-eyebrow': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		color: 'var(--muted)',
		opacity: '0.7'
	},
	// Type chip
	'.bk-type-chip': {
		display: 'inline-flex',
		alignItems: 'center',
		padding: '0.2rem 0.65rem',
		borderRadius: 'var(--radius-pill)',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.04em',
		alignSelf: 'flex-start',
		background: 'var(--chip-other)',
		color: 'var(--chip-other-fg)'
	},
	'.bk-type-chip--invoice': {
		background: 'var(--chip-invoice)',
		color: 'var(--chip-invoice-fg)'
	},
	'.bk-type-chip--bank_statement': {
		background: 'var(--chip-bank)',
		color: 'var(--chip-bank-fg)'
	},
	'.bk-type-chip--contract': {
		background: 'var(--chip-contract)',
		color: 'var(--chip-contract-fg)'
	},
	'.bk-type-chip--other': {
		background: 'var(--chip-other)',
		color: 'var(--chip-other-fg)'
	},
	'.bk-title': {
		margin: '0',
		fontSize: 'var(--fs-title)',
		fontWeight: '600',
		lineHeight: '1.25',
		letterSpacing: '-0.02em',
		color: 'var(--text)'
	},
	'.bk-description': {
		fontSize: 'var(--fs-body)',
		color: 'var(--muted)',
		lineHeight: '1.5'
	},
	'.bk-tags': {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '0.35rem',
		marginTop: '0.25rem'
	},
	'.bk-tag': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '500',
		color: 'var(--muted-strong)',
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.15rem 0.5rem'
	},
	// Parties involved
	'.bk-parties': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.3rem',
		marginTop: '0.5rem'
	},
	'.bk-parties-label': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		color: 'var(--muted)',
		opacity: '0.7'
	},
	'.bk-party': {
		display: 'flex',
		alignItems: 'baseline',
		gap: '0.5rem',
		fontSize: 'var(--fs-body)',
		lineHeight: '1.4'
	},
	'.bk-party-role': {
		flexShrink: '0',
		minWidth: '5.5rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)'
	},
	'.bk-party-name': {
		color: 'var(--text)',
		fontWeight: '500'
	},
	'.bk-empty': {
		color: 'var(--muted)',
		fontSize: 'var(--fs-body)',
		padding: '1rem 0',
		textAlign: 'center',
		flex: '1',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center'
	},
	'@media (max-width: 600px)': {
		'.bk-layout': { gridTemplateColumns: '1fr', gridTemplateRows: 'auto auto' }
	}
}

export const bookkeepingStyle: StyleDef = withBrand({ tokens, selectors })
