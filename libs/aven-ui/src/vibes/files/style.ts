import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

const selectors: StyleDef['selectors'] = {
	'.fl-head': {
		display: 'flex',
		alignItems: 'flex-end',
		justifyContent: 'space-between',
		gap: 'var(--gap)',
		marginBottom: 'var(--gap)'
	},
	'.fl-title': {
		margin: '0',
		fontSize: 'var(--fs-hero)',
		fontWeight: '500',
		letterSpacing: 'var(--tracking-tight)'
	},
	'.fl-count': {
		fontSize: 'var(--fs-meta)',
		fontFamily: 'var(--font-mono)',
		color: 'var(--muted)'
	},
	'.fl-list': { display: 'flex', flexDirection: 'column', gap: 'var(--gap)' },
	'.fl-empty': { fontSize: 'var(--fs-body)', color: 'var(--muted)' },
	'.fl-list:has(.fl-row) .fl-empty': { display: 'none' },
	'.fl-row': {
		display: 'flex',
		alignItems: 'center',
		gap: 'var(--gap)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-inner)',
		padding: 'var(--pad-card-sm)',
		background: 'var(--surface)'
	},
	'.fl-icon': {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '2.25rem',
		height: '2.25rem',
		flexShrink: '0',
		borderRadius: 'var(--radius-inner)',
		border: '1px solid var(--border)',
		fontSize: 'var(--fs-lead)'
	},
	'.fl-body': { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '0', flex: '1' },
	'.fl-name': {
		fontSize: 'var(--fs-title)',
		fontWeight: '500',
		color: 'var(--text)',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis'
	},
	'.fl-meta': { fontSize: 'var(--fs-meta)', color: 'var(--muted)', fontFamily: 'var(--font-mono)' },
	'.fl-kind': {
		flexShrink: '0',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: 'var(--tracking-eyebrow)',
		textTransform: 'uppercase',
		color: 'var(--muted)',
		borderRadius: 'var(--radius-chip)',
		border: '1px solid var(--border-soft)',
		padding: '0.25rem 0.55rem'
	}
}

export const filesStyle: StyleDef = withBrand({ selectors })
