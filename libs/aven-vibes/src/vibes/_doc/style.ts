import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// Shared styling for the generic structured-document view. Brand layer + a clean sections/cards/
// table layout (the legacy invoice/bank/contract layouts, unified under one cleaner design). 0064.
const selectors: StyleDef['selectors'] = {
	// board 0097 — the brand base fills the shadow-DOM :host with var(--bg-a); for the doc view that
	// solid host background overwrites the host card's own bg (e.g. InvoiceDocVibe's bg-card). Make the
	// host transparent so the surrounding card background shows through the sections.
	':host': { background: 'transparent' },
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
	// board 0097 — when a host (e.g. InvoiceDocVibe with its own hero) blanks the title/subtitle, collapse
	// the empty flex children so they leave no gap.
	'.doc-title:empty': { display: 'none' },
	'.doc-subtitle:empty': { display: 'none' },
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
		gap: '0.8rem'
	},
	// board 0097 — party cards + rows scaled up a notch to mimic the legacy OCR invoice layout; the
	// card fill is TRANSPARENT so the host card's own background (bg-card) shows through — only the
	// border delineates each card. Empty card grids collapse.
	'.doc-cards:empty': { display: 'none' },
	'.doc-card': {
		background: 'transparent',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '0.9rem 1.05rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.2rem'
	},
	// PANEL — wraps a section's key/value list + table as ONE card (Positionen, Summen). Transparent
	// fill (bg looks through); empty panels (e.g. the Parteien section, cards only) are hidden.
	'.doc-panel': {
		background: 'transparent',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '0.85rem 1.05rem',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.5rem'
	},
	'.doc-panel:not(:has(.doc-kv-row)):not(:has(td))': { display: 'none' },
	'.doc-kv:empty': { display: 'none' },
	'.doc-table:not(:has(td)):not(:has(th))': { display: 'none' },
	'.doc-card-title': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		color: 'var(--muted)'
	},
	'.doc-card-name': {
		fontSize: '1rem',
		fontWeight: '700',
		color: 'var(--text)',
		lineHeight: '1.3',
		marginBottom: '0.25rem'
	},
	'.doc-card-line': {
		fontSize: '0.8125rem',
		color: 'var(--muted)',
		lineHeight: '1.5'
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
		fontSize: '0.9375rem',
		lineHeight: '1.55',
		borderBottom: '1px solid var(--border)',
		padding: '0.35rem 0'
	},
	'.doc-kv-row:last-child': { borderBottom: 'none' },
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
		fontSize: '0.8125rem',
		color: 'var(--text)'
	},
	'.doc-th': {
		textAlign: 'left',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.04em',
		padding: '0.4rem 0.5rem',
		borderBottom: '1px solid var(--border)'
	},
	'.doc-td': {
		textAlign: 'left',
		padding: '0.45rem 0.5rem',
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
