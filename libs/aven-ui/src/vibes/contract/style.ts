import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// All colours, radii, fonts and the dark-blue ink now come from the shared
// brand layer (withBrand). Only contract-specific selectors remain below.
const selectors: StyleDef['selectors'] = {
	'.cv-shell': {
		padding: 'var(--pad-card)',
		borderRadius: 'var(--radius-card)',
		background: 'var(--tech-fill)',
		border: 'none',
		maxWidth: 'var(--max-w)',
		margin: '0 auto'
	},
	'.cv-hero': {
		background: 'var(--tech-fill-inner)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		padding: '1rem 1.25rem 1.1rem',
		marginBottom: '1rem'
	},
	'.cv-hero-eyebrow': {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		letterSpacing: '0.1em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
		opacity: '0.65',
		marginBottom: '0.35rem'
	},
	'.cv-hero-title': {
		margin: '0',
		fontSize: 'var(--fs-hero)',
		fontWeight: '600',
		lineHeight: '1.25',
		letterSpacing: '-0.02em'
	},
	'.cv-hero-meta': {
		display: 'flex',
		flexWrap: 'wrap',
		gap: '0.65rem 1.25rem',
		marginTop: '0.75rem',
		fontSize: 'var(--fs-meta)',
		color: 'var(--muted)'
	},
	'.cv-hero-meta strong': { color: 'var(--text)', fontWeight: '500' },
	'.cv-parties': {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
		gap: '12px',
		marginBottom: '1rem'
	},
	'.cv-party': {
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		padding: '14px 16px'
	},
	'.cv-party-role': {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.1em',
		color: 'var(--brand-accent)',
		marginBottom: '6px'
	},
	'.cv-party-name': {
		fontSize: 'var(--fs-title)',
		fontWeight: '600',
		lineHeight: '1.3',
		marginBottom: '4px'
	},
	'.cv-party-line': {
		fontSize: 'var(--fs-meta)',
		color: 'var(--muted)',
		lineHeight: '1.45',
		marginTop: '3px',
		whiteSpace: 'pre-line'
	},
	'.cv-preamble': {
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		padding: '14px 18px',
		marginBottom: '1rem',
		fontSize: 'var(--fs-body)',
		lineHeight: '1.55',
		color: 'var(--text)',
		whiteSpace: 'pre-line'
	},
	'.cv-preamble h3': {
		margin: '0 0 8px',
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		color: 'var(--muted)'
	},
	'.cv-defs': { marginBottom: '1rem', padding: '0 4px' },
	'.cv-defs h3': {
		margin: '0 0 10px',
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		color: 'var(--muted)'
	},
	'.cv-def-row': {
		display: 'grid',
		gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2.2fr)',
		gap: '10px 18px',
		padding: '10px 0',
		borderBottom: '1px solid color-mix(in srgb, var(--border) 45%, transparent)',
		fontSize: 'var(--fs-meta)'
	},
	'.cv-def-row:last-child': { borderBottom: 'none' },
	'.cv-def-term': { fontWeight: '600', color: 'var(--text)' },
	'.cv-def-body': { color: 'var(--muted)', lineHeight: '1.45' },
	'.cv-clauses': { marginBottom: '1rem' },
	'.cv-clause': {
		background: 'var(--tech-fill-inner)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-md)',
		padding: '12px 16px 14px',
		marginBottom: '10px'
	},
	'.cv-clause-head': {
		display: 'flex',
		flexWrap: 'wrap',
		alignItems: 'baseline',
		gap: '6px 12px',
		marginBottom: '8px'
	},
	'.cv-clause-num': {
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontSize: 'var(--fs-meta)',
		fontWeight: '600',
		color: 'var(--brand-accent)'
	},
	'.cv-clause-title': { fontSize: 'var(--fs-section)', fontWeight: '600' },
	'.cv-clause-body': {
		fontSize: 'var(--fs-body)',
		lineHeight: '1.55',
		whiteSpace: 'pre-line',
		color: 'var(--text)'
	},
	'.cv-clause-num:empty, .cv-clause-title:empty, .cv-clause-body:empty, .cv-sign-meta:empty': {
		display: 'none'
	},
	'.cv-clause-head:empty': { display: 'none', marginBottom: '0' },
	'.cv-subclause': {
		marginTop: '10px',
		paddingLeft: '12px',
		borderLeft: '2px solid color-mix(in srgb, var(--brand-accent) 55%, transparent)'
	},
	'.cv-subclause-label': {
		fontSize: 'var(--fs-meta)',
		fontWeight: '600',
		marginBottom: '4px',
		color: 'var(--muted)'
	},
	'.cv-subclause-body': {
		fontSize: 'var(--fs-meta)',
		lineHeight: '1.5',
		color: 'var(--text)',
		whiteSpace: 'pre-line'
	},
	'.cv-signatures': {
		background: 'var(--tech-fill)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-2xl)',
		padding: '14px 18px 18px',
		marginBottom: '10px'
	},
	'.cv-signatures h3': {
		margin: '0 0 12px',
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		color: 'var(--muted)'
	},
	'.cv-sign-grid': {
		display: 'grid',
		gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
		gap: '14px'
	},
	'.cv-sign-block': {
		minHeight: '72px',
		paddingTop: '6px',
		borderTop: '1px solid color-mix(in srgb, var(--text) 10%, transparent)'
	},
	'.cv-sign-party': {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		color: 'var(--muted)',
		marginBottom: '4px'
	},
	'.cv-sign-name': { fontSize: 'var(--fs-body)', fontWeight: '600' },
	'.cv-sign-meta': { fontSize: 'var(--fs-eyebrow)', color: 'var(--muted)', marginTop: '4px' },
	'.cv-footnote': {
		fontSize: 'var(--fs-eyebrow)',
		lineHeight: '1.45',
		color: 'var(--muted)',
		fontStyle: 'italic',
		padding: '0 4px 8px'
	},
	'@media (max-width: 560px)': {
		'.cv-def-row': { gridTemplateColumns: '1fr' }
	}
}

export const contractStyle: StyleDef = withBrand({ selectors })
