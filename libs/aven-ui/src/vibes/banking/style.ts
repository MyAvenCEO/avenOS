import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// Banking vibe (board 0088). Reuses the shared brand layer (colours/radii/fonts) and the
// navy action accent from the bank/todos vibes; monospace for money + addresses.
const tokens: StyleDef['tokens'] = {
	'brand-accent': '#1e293b',
	'brand-accent-fg': '#f8fafc',
	'bk-in': '#15803d',
	'bk-out': '#b45309'
}

const selectors: StyleDef['selectors'] = {
	'.bk-ui-container': {
		minHeight: '100%',
		width: '100%',
		maxWidth: 'var(--max-w)',
		margin: '0 auto',
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap-section)',
		boxSizing: 'border-box',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em'
	},
	'.bk-card': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: 'var(--pad-card)'
	},
	'.bk-card h4': {
		margin: '0 0 12px 0',
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.12em',
		opacity: '0.6'
	},
	// Mint card is hidden for non-admins.
	'.bk-card--admin[data-admin="false"]': { display: 'none' },
	'.bk-wallet': {
		background:
			'linear-gradient(135deg, var(--brand-accent), color-mix(in srgb, var(--brand-accent) 70%, #334155))',
		color: 'var(--brand-accent-fg)',
		border: '1px solid color-mix(in srgb, var(--brand-accent-fg) 14%, transparent)'
	},
	'.bk-wallet-head': {
		display: 'grid',
		gridTemplateColumns: '1fr auto',
		gap: '12px 24px',
		alignItems: 'start'
	},
	'.bk-eyebrow': {
		display: 'block',
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		opacity: '0.7',
		marginBottom: '8px'
	},
	'.bk-balance': {
		margin: '0',
		fontSize: 'var(--fs-hero)',
		fontWeight: '600',
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
		lineHeight: '1.1'
	},
	'.bk-wallet-meta': { textAlign: 'right', display: 'grid', gap: '4px' },
	'.bk-field-label': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		opacity: '0.6',
		marginBottom: '4px'
	},
	'.bk-address': {
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontSize: 'var(--fs-body)',
		opacity: '0.92'
	},
	'.bk-supply': { fontSize: 'var(--fs-micro)', opacity: '0.7', marginTop: '6px' },
	'.bk-form-row': { display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'stretch' },
	'.bk-input': {
		flex: '1',
		minWidth: '160px',
		font: 'inherit',
		fontFamily: 'ui-monospace, Menlo, monospace',
		color: 'inherit',
		background: 'var(--tech-fill-inner)',
		border: '1px solid var(--border-soft)',
		borderRadius: 'var(--radius-md)',
		padding: '0.55rem 0.85rem',
		outline: 'none'
	},
	'.bk-input:focus': {
		borderColor: 'var(--brand-accent)',
		boxShadow: '0 0 0 2px color-mix(in srgb, var(--brand-accent) 28%, transparent)'
	},
	'.bk-btn': {
		font: 'inherit',
		cursor: 'pointer',
		borderRadius: 'var(--radius-md)',
		padding: '0.5rem 1.1rem',
		fontWeight: '500',
		fontSize: 'var(--fs-body)',
		transition: 'background 0.15s ease, filter 0.15s ease'
	},
	'.bk-btn--primary': {
		background: 'var(--brand-accent)',
		color: 'var(--brand-accent-fg)',
		border: '1px solid color-mix(in srgb, var(--text) 12%, transparent)'
	},
	'.bk-btn--primary:hover': { filter: 'brightness(1.08)' },
	'.bk-recipients': { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' },
	'.bk-chip': {
		font: 'inherit',
		cursor: 'pointer',
		fontSize: 'var(--fs-body)',
		padding: '0.4rem 0.8rem',
		borderRadius: '999px',
		border: '1px solid var(--border)',
		background: 'var(--tech-fill)',
		color: 'var(--text)',
		transition: 'background 0.15s ease, border-color 0.15s ease'
	},
	'.bk-chip--on': {
		background: 'var(--brand-accent)',
		color: 'var(--brand-accent-fg)',
		borderColor: 'color-mix(in srgb, var(--text) 14%, transparent)'
	},
	'.bk-note': {
		marginTop: '10px',
		minHeight: '1.1em',
		fontSize: 'var(--fs-micro)',
		color: 'var(--bk-out)'
	},
	'.bk-card--list': { display: 'flex', flexDirection: 'column' },
	'.bk-list-head': {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'baseline',
		gap: '12px'
	},
	'.bk-list-head h4': { margin: '0' },
	'.bk-chain-tag': {
		fontSize: 'var(--fs-micro)',
		fontFamily: 'ui-monospace, Menlo, monospace',
		color: 'var(--muted)',
		opacity: '0.7'
	},
	'.bk-list': {
		listStyle: 'none',
		margin: '12px 0 0 0',
		padding: '0',
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap)'
	},
	'.bk-list .bk-empty': {
		textAlign: 'center',
		color: 'var(--muted)',
		padding: '1.25rem 1rem',
		fontSize: 'var(--fs-body)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-md)'
	},
	'.bk-empty--inline': {
		padding: '0.3rem 0',
		border: 'none',
		fontSize: 'var(--fs-micro)'
	},
	'.bk-list:has(.bk-tx) li[data-empty="true"]': { display: 'none' },
	'.bk-recipients:has(.bk-chip) span[data-empty="true"]': { display: 'none' },
	'.bk-tx': {
		display: 'flex',
		flexDirection: 'column',
		gap: '4px',
		padding: '12px 14px',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-md)',
		background: 'var(--tech-fill)'
	},
	'.bk-tx-main': {
		display: 'flex',
		justifyContent: 'space-between',
		alignItems: 'baseline',
		gap: '12px'
	},
	'.bk-tx-label': { fontWeight: '600', fontSize: 'var(--fs-title)' },
	'.bk-tx-amount': {
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
		fontWeight: '600'
	},
	'.bk-tx-amount--in': { color: 'var(--bk-in)' },
	'.bk-tx-amount--out': { color: 'var(--bk-out)' },
	'.bk-tx-sub': {
		display: 'flex',
		justifyContent: 'space-between',
		gap: '12px',
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted)'
	},
	'.bk-tx-party': { fontFamily: 'ui-monospace, Menlo, monospace' },
	'.bk-tx-verified': { color: 'var(--bk-in)', fontWeight: '500' },
	'.bk-tx-verified--bad': { color: '#dc2626' },
	'@media (max-width: 560px)': {
		'.bk-wallet-head': { gridTemplateColumns: '1fr' },
		'.bk-wallet-meta': { textAlign: 'left' }
	}
}

export const bankingStyle: StyleDef = withBrand({ tokens, selectors })
