import type { StyleDef } from '../../engine/types.js'

// Shared brand layer provides colours/radii/fonts/ink. Todos keeps its navy action accent
// and the row divider. Scale is intentionally COMPACT (tight gaps/padding/text) — closer
// to the chat todos card, brand-styled. board 0054.
const tokens: StyleDef['tokens'] = {
	'row-divider': 'color-mix(in srgb, var(--border) 55%, transparent)',
	'brand-accent': '#1e293b',
	'brand-accent-fg': '#f8fafc',
	// Priority palette — warm brand tones (terracotta / ochre / sage), muted for pills.
	'prio-high': '#c1502e',
	'prio-medium': '#b0803a',
	'prio-low': '#5f8a63'
}

const selectors: StyleDef['selectors'] = {
	'.td-ui-container': {
		minHeight: '100%',
		width: '100%',
		maxWidth: 'var(--max-w)',
		margin: '0 auto',
		padding: '0',
		background: 'transparent',
		border: 'none',
		display: 'flex',
		flexDirection: 'column',
		gap: '0.85rem',
		boxSizing: 'border-box',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em'
	},
	'.td-card': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1rem 1.15rem',
		marginBottom: '0'
	},
	'.td-card:last-child': { marginBottom: '0' },
	'.td-card h4': {
		margin: '0 0 6px 0',
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.12em',
		opacity: '0.55'
	},
	'.td-banner-grid': {
		display: 'grid',
		gridTemplateColumns: '1fr auto',
		gap: '4px 16px',
		alignItems: 'end'
	},
	'.td-eyebrow': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.4rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.08em',
		opacity: '0.6',
		marginBottom: '5px'
	},
	'.td-eyebrow::before': {
		content: '"✳"',
		fontSize: '0.9em',
		lineHeight: '1',
		color: 'var(--brand-accent)',
		opacity: '0.85'
	},
	'.td-banner-title': {
		margin: '0',
		fontFamily: 'var(--font-display)',
		fontSize: 'var(--fs-lead)',
		fontWeight: '500',
		letterSpacing: '-0.01em',
		color: 'var(--text)',
		lineHeight: '1.15'
	},
	'.td-field-label': {
		display: 'block',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted)',
		textTransform: 'uppercase',
		letterSpacing: '0.06em',
		marginBottom: '3px'
	},
	'.td-banner-stat': { textAlign: 'right' },
	'.td-banner-stat .td-field-label': { textAlign: 'right' },
	'.td-banner-accent': {
		fontSize: 'var(--fs-lead)',
		fontWeight: '600',
		fontFamily: 'ui-monospace, Menlo, monospace',
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--brand-accent)',
		lineHeight: '1.15'
	},
	'.td-card--list': {
		flex: '1',
		minHeight: '0',
		display: 'flex',
		flexDirection: 'column',
		marginBottom: '0',
		padding: '0.3rem 1.15rem',
		overflow: 'hidden'
	},
	'.td-add-form': {
		display: 'flex',
		gap: '6px',
		flexWrap: 'wrap',
		alignItems: 'stretch'
	},
	'.td-input': {
		flex: '1',
		minWidth: '140px',
		font: 'inherit',
		fontSize: 'var(--fs-body)',
		color: 'inherit',
		background: 'var(--tech-fill-inner)',
		border: '1px solid var(--border-soft)',
		borderRadius: 'var(--radius-md)',
		padding: '0.4rem 0.6rem',
		outline: 'none'
	},
	'.td-input:focus': {
		borderColor: 'var(--brand-accent)',
		boxShadow: '0 0 0 2px color-mix(in srgb, var(--brand-accent) 28%, transparent)'
	},
	'.td-btn': {
		font: 'inherit',
		cursor: 'pointer',
		borderRadius: 'var(--radius-md)',
		padding: '0.35rem 0.7rem',
		fontWeight: '500',
		fontSize: 'var(--fs-body)',
		transition: 'background 0.15s ease, border-color 0.15s ease, filter 0.15s ease'
	},
	'.td-btn--primary': {
		background: 'var(--brand-accent)',
		color: 'var(--brand-accent-fg)',
		border: '1px solid color-mix(in srgb, var(--text) 12%, transparent)'
	},
	'.td-btn--primary:hover': { filter: 'brightness(1.03)' },
	'.td-btn--ghost': {
		background: 'var(--tech-fill-inner)',
		border: '1px solid var(--border-soft)',
		color: 'var(--text)'
	},
	'.td-btn--ghost:disabled': { opacity: '0.45', cursor: 'not-allowed' },
	'.td-btn--icon': {
		border: 'none',
		background: 'transparent',
		color: 'var(--muted)',
		fontSize: 'var(--fs-lead)',
		lineHeight: '1',
		padding: '0.1rem 0.35rem',
		fontWeight: '400'
	},
	'.td-btn--icon:hover': { color: '#dc2626' },
	'.td-list': {
		listStyle: 'none',
		margin: '0',
		padding: '0',
		flex: '1',
		minHeight: '48px',
		overflowY: 'auto',
		display: 'flex',
		flexDirection: 'column'
	},
	// The view engine wraps `$each` rows in a single <div>; rows are separated by their own
	// bottom-divider (mockup table look), so the wrapper carries no gap. board 0111.
	'.td-list > div': {
		display: 'flex',
		flexDirection: 'column'
	},
	'.td-list li.empty': {
		textAlign: 'center',
		color: 'var(--muted)',
		padding: '1.1rem 0.85rem',
		fontSize: 'var(--fs-body)'
	},
	'.td-list:has(.td-row) li[data-empty="true"]': { display: 'none' },
	'.td-row': {
		display: 'flex',
		alignItems: 'center',
		gap: '0.7rem',
		padding: '0.72rem 0.15rem',
		borderBottom: '1px solid var(--row-divider)',
		background: 'transparent',
		// Never let flexbox compress a row when the list is height-constrained — the
		// "task list squeezes itself" look; rows keep their natural height.
		flexShrink: '0',
		animation: 'td-slide-in 0.18s ease-out',
		transition: 'background 0.12s ease'
	},
	'.td-list > div .td-row:last-child': { borderBottom: 'none' },
	'.td-row:hover': { background: 'color-mix(in srgb, var(--text) 3.5%, transparent)' },
	'.td-row input[type="checkbox"]': {
		appearance: 'none',
		WebkitAppearance: 'none',
		width: '1.05rem',
		height: '1.05rem',
		margin: '0',
		flexShrink: '0',
		borderRadius: '50%',
		background: 'var(--tech-fill-inner)',
		border: '1px solid var(--border)',
		cursor: 'pointer',
		display: 'grid',
		placeContent: 'center',
		transition: 'background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease'
	},
	'.td-row input[type="checkbox"]:checked': {
		background: 'var(--brand-accent)',
		borderColor: 'color-mix(in srgb, var(--text) 14%, transparent)'
	},
	'.td-row input[type="checkbox"]::after': {
		content: '""',
		width: '0.26rem',
		height: '0.5rem',
		border: 'solid var(--brand-accent-fg)',
		borderWidth: '0 2px 2px 0',
		transform: 'rotate(45deg) translate(-0.5px, -1px)',
		opacity: '0',
		boxSizing: 'content-box'
	},
	'.td-row input[type="checkbox"]:checked::after': { opacity: '1' },
	'.td-row-text': {
		flex: '1',
		minWidth: '0',
		outline: 'none',
		padding: '0.05rem 0.2rem',
		borderRadius: '0.35rem',
		fontSize: 'var(--fs-body)',
		// match the card titles (.vc-pred) so the list and the created/edited/deleted cards read at ONE
		// weight — a step up from the ExtraLight body, not thin. board 0111.
		fontWeight: '500',
		whiteSpace: 'nowrap',
		overflow: 'hidden',
		textOverflow: 'ellipsis'
	},
	'.td-status': {
		width: '0.9rem',
		height: '0.9rem',
		flexShrink: '0',
		borderRadius: '50%',
		border: '1.5px solid var(--border)',
		background: 'var(--tech-fill-inner)'
	},
	'.td-row.done .td-status': {
		background: 'var(--brand-accent)',
		borderColor: 'color-mix(in srgb, var(--text) 14%, transparent)'
	},
	'.td-chip': {
		display: 'inline-flex',
		alignItems: 'center',
		flexShrink: '0',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		lineHeight: '1.4',
		padding: '0.12rem 0.5rem',
		borderRadius: '999px',
		background: 'var(--tech-fill-inner)',
		color: 'var(--muted)',
		border: '1px solid var(--border-soft)',
		whiteSpace: 'nowrap'
	},
	'.td-chip:empty': { display: 'none' },
	// board 0112 — the GOAL chip: brand-navy tint with the ✳ marker, distinct from the priority tones.
	'.td-chip--goal': {
		gap: '0.3rem',
		color: 'var(--brand-accent)',
		background: 'color-mix(in srgb, var(--brand-accent) 7%, transparent)',
		borderColor: 'color-mix(in srgb, var(--brand-accent) 22%, transparent)'
	},
	'.td-chip--goal::before': { content: '"✳"', fontSize: '0.9em', lineHeight: '1', opacity: '0.8' },
	'.td-chip--due': {
		fontVariantNumeric: 'tabular-nums',
		letterSpacing: '-0.01em',
		gap: '0.3rem'
	},
	'.td-chip--due::before': {
		content: '"◷"',
		fontSize: '0.95em',
		opacity: '0.7',
		lineHeight: '1'
	},
	// Priority pill: leading dot + tinted fill, colour-coded by the row's data-prio.
	'.td-chip--prio': {
		textTransform: 'capitalize',
		gap: '0.34rem',
		color: 'var(--muted-strong)',
		background: 'transparent',
		borderColor: 'var(--border-soft)'
	},
	'.td-chip--prio::before': {
		content: '""',
		width: '0.42rem',
		height: '0.42rem',
		borderRadius: '50%',
		background: 'var(--muted)',
		flexShrink: '0'
	},
	'.td-row[data-prio="high"] .td-chip--prio': {
		color: 'var(--prio-high)',
		background: 'color-mix(in srgb, var(--prio-high) 9%, transparent)',
		borderColor: 'color-mix(in srgb, var(--prio-high) 26%, transparent)'
	},
	'.td-row[data-prio="high"] .td-chip--prio::before': { background: 'var(--prio-high)' },
	'.td-row[data-prio="medium"] .td-chip--prio': {
		color: 'var(--prio-medium)',
		background: 'color-mix(in srgb, var(--prio-medium) 10%, transparent)',
		borderColor: 'color-mix(in srgb, var(--prio-medium) 28%, transparent)'
	},
	'.td-row[data-prio="medium"] .td-chip--prio::before': { background: 'var(--prio-medium)' },
	'.td-row[data-prio="low"] .td-chip--prio': {
		color: 'var(--prio-low)',
		background: 'color-mix(in srgb, var(--prio-low) 11%, transparent)',
		borderColor: 'color-mix(in srgb, var(--prio-low) 28%, transparent)'
	},
	'.td-row[data-prio="low"] .td-chip--prio::before': { background: 'var(--prio-low)' },
	'.td-row.done .td-row-text': {
		textDecoration: 'line-through',
		color: 'var(--muted)'
	},
	// board 0112 — SUB-TASKS: children render indented under their parent with a ↳ marker (the logic
	// orders them depth-first). The status dot keeps the hierarchy scannable.
	'.td-row.sub': { paddingLeft: '1.75rem' },
	'.td-row.sub .td-row-text::before': {
		content: '"↳ "',
		color: 'var(--muted)',
		opacity: '0.7'
	},
	'.td-list-footer': {
		display: 'flex',
		justifyContent: 'flex-end',
		marginTop: '8px',
		paddingTop: '8px',
		borderTop: '1px solid color-mix(in srgb, var(--text) 10%, transparent)',
		flexShrink: '0'
	},
	'@keyframes td-slide-in': {
		from: { opacity: '0', transform: 'translateY(-3px)' },
		to: { opacity: '1', transform: 'translateY(0)' }
	},
	'@media (max-width: 560px)': {
		'.td-banner-grid': { gridTemplateColumns: '1fr' },
		'.td-banner-stat, .td-banner-stat .td-field-label': { textAlign: 'left' }
	}
}

export const todoStyle: StyleDef = { extends: 'brand', tokens, selectors }
