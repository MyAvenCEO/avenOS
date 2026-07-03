import { withBrand } from '../../brand-style.js'
import type { StyleDef } from '../../engine/types.js'

// board 0111 — the ONE shared style for every read-only chat/Runs card (todos created/edited/deleted,
// ontology, query/mutation results, bundle-created). Composed on the brand layer so it inherits the Azeret
// body + Clash titles + the brand palette, and restyled to MATCH the interactive todos list: a bordered
// surface list-card with divider rows, a ✳ sparkle eyebrow marker, warm status accents, and colour-coded
// priority pills. This is the DRY source-of-truth; the migration imports it and seeds every card's
// vibe_style row from here (no inline CSS in the migration, no runtime UPDATE hacks).
const tokens: StyleDef['tokens'] = {
	// warm status/priority accents — the same tones as the todos list (sage / ochre / terracotta).
	green: '#5f8a63',
	amber: '#b0803a',
	red: '#c1502e',
	'prio-high': '#c1502e',
	'prio-medium': '#b0803a',
	'prio-low': '#5f8a63',
	'row-divider': 'color-mix(in srgb, var(--border) 55%, transparent)'
}

const selectors: StyleDef['selectors'] = {
	'.vc-root': {
		display: 'flex',
		flexDirection: 'column',
		gap: '0.55rem',
		fontFamily: 'var(--font-sans)',
		color: 'var(--text)',
		letterSpacing: '-0.02em'
	},
	// header: an eyebrow with the ✳ sparkle marker (matches the list banner); the legacy dot is hidden.
	'.vc-dot': { display: 'none' },
	'.vc-header': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.45rem',
		marginBottom: '0.15rem'
	},
	'.vc-eyebrow': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.4rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.08em',
		textTransform: 'uppercase',
		color: 'var(--muted)'
	},
	'.vc-eyebrow::before': {
		content: '"✳"',
		fontSize: '0.9em',
		lineHeight: '1',
		color: 'var(--brand-accent)',
		opacity: '0.85'
	},
	'.vc-eyebrow--green': { color: 'var(--green)' },
	'.vc-eyebrow--red': { color: 'var(--red)' },
	'.vc-eyebrow--amber': { color: 'var(--amber)' },
	'.vc-title': {
		fontFamily: 'var(--font-display)',
		fontSize: 'var(--fs-title)',
		fontWeight: '500',
		color: 'var(--text)'
	},
	'.vc-meta': { fontSize: 'var(--fs-micro)', color: 'var(--muted)', opacity: '0.7' },
	'.vc-request': { fontSize: 'var(--fs-body)', color: 'var(--muted)', margin: '0.1rem 0 0.35rem' },
	'.vc-request:empty': { display: 'none' },
	// the list is ONE bordered surface card; rows are divider-separated (the list-view table look).
	'.vc-list': {
		display: 'flex',
		flexDirection: 'column',
		listStyle: 'none',
		margin: '0',
		padding: '0 1.05rem',
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		overflow: 'hidden'
	},
	'.vc-list + .vc-list': { marginTop: '0.4rem' },
	'.vc-row': {
		display: 'flex',
		alignItems: 'center',
		gap: '0.7rem',
		padding: '0.72rem 0.1rem',
		borderBottom: '1px solid var(--row-divider)',
		fontSize: 'var(--fs-body)'
	},
	// the engine wraps `$each` rows in a <div>; drop the divider on the final row either way.
	'.vc-list > div > .vc-row:last-child, .vc-list > .vc-row:last-child': { borderBottom: 'none' },
	// stacked variant — edited diffs (title over the change line).
	'.vc-row--stack': { flexDirection: 'column', alignItems: 'stretch', gap: '0.2rem' },
	// trailing group pushed to the right edge of a row (due + priority chips).
	'.vc-trail': { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', flexShrink: '0' },
	'.vc-pred': {
		fontFamily: 'var(--font-sans)',
		fontSize: 'var(--fs-body)',
		fontWeight: '500',
		color: 'var(--text)',
		minWidth: '0',
		overflow: 'hidden',
		textOverflow: 'ellipsis',
		whiteSpace: 'nowrap'
	},
	'.vc-gismu': { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
	'.vc-kind': {
		fontSize: 'var(--fs-micro)',
		background: 'color-mix(in srgb, var(--text) 7%, transparent)',
		color: 'var(--muted)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.1rem 0.45rem',
		flexShrink: '0'
	},
	'.vc-field': { fontSize: 'var(--fs-micro)', color: 'var(--muted)' },
	// a due chip (◷) + a colour-coded priority pill (dot + tint), matching the list rows.
	'.vc-due': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.3rem',
		fontSize: 'var(--fs-micro)',
		fontVariantNumeric: 'tabular-nums',
		color: 'var(--muted)',
		border: '1px solid var(--border-soft)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.12rem 0.5rem',
		whiteSpace: 'nowrap'
	},
	'.vc-due:empty': { display: 'none' },
	'.vc-due::before': { content: '"◷"', fontSize: '0.95em', opacity: '0.7', lineHeight: '1' },
	'.vc-prio': {
		display: 'inline-flex',
		alignItems: 'center',
		gap: '0.34rem',
		textTransform: 'capitalize',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		color: 'var(--muted-strong)',
		border: '1px solid var(--border-soft)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.12rem 0.55rem',
		whiteSpace: 'nowrap'
	},
	'.vc-prio:empty': { display: 'none' },
	'.vc-prio::before': {
		content: '""',
		width: '0.42rem',
		height: '0.42rem',
		borderRadius: '50%',
		background: 'var(--muted)',
		flexShrink: '0'
	},
	'.vc-prio[data-prio="high"]': {
		color: 'var(--prio-high)',
		background: 'color-mix(in srgb, var(--prio-high) 9%, transparent)',
		borderColor: 'color-mix(in srgb, var(--prio-high) 26%, transparent)'
	},
	'.vc-prio[data-prio="high"]::before': { background: 'var(--prio-high)' },
	'.vc-prio[data-prio="medium"]': {
		color: 'var(--prio-medium)',
		background: 'color-mix(in srgb, var(--prio-medium) 10%, transparent)',
		borderColor: 'color-mix(in srgb, var(--prio-medium) 28%, transparent)'
	},
	'.vc-prio[data-prio="medium"]::before': { background: 'var(--prio-medium)' },
	'.vc-prio[data-prio="low"]': {
		color: 'var(--prio-low)',
		background: 'color-mix(in srgb, var(--prio-low) 11%, transparent)',
		borderColor: 'color-mix(in srgb, var(--prio-low) 28%, transparent)'
	},
	'.vc-prio[data-prio="low"]::before': { background: 'var(--prio-low)' },
	// standalone inner card (bundle-created / ontology-created items) — a brand surface box.
	'.vc-card': {
		border: '1px solid var(--border)',
		background: 'var(--surface)',
		borderRadius: 'var(--radius-inner)',
		padding: '0.85rem 1rem'
	},
	'.vc-label': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: '0.08em',
		textTransform: 'uppercase',
		color: 'var(--muted)',
		marginBottom: '0.35rem'
	},
	'.vc-label--mt': { marginTop: '0.75rem' },
	'.vc-crow': { display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' },
	'.vc-places-text': {
		fontFamily: 'var(--font-mono)',
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted)',
		marginTop: '0.1rem'
	},
	'.vc-chips': { display: 'flex', flexWrap: 'wrap', gap: '0.375rem' },
	'.vc-chip': {
		display: 'inline-flex',
		gap: '0.25rem',
		border: '1px solid var(--border-soft)',
		borderRadius: 'var(--radius-pill)',
		padding: '0.12rem 0.55rem',
		fontSize: 'var(--fs-micro)',
		color: 'var(--muted)'
	},
	'.vc-chip-k': { fontWeight: '500', color: 'var(--text)' },
	'.vc-chip-v': { fontFamily: 'var(--font-mono)', color: 'var(--muted)' },
	'.vc-minted': { fontSize: 'var(--fs-body)', color: 'var(--muted)', marginTop: '0.5rem' },
	'.vc-minted:empty': { display: 'none' },
	'.vc-empty': {
		border: '1px dashed var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: '1.1rem 1.25rem',
		textAlign: 'center',
		fontSize: 'var(--fs-body)',
		color: 'var(--muted)'
	},
	'.vc-empty:empty': { display: 'none' },
	'.vc-reused': { color: 'var(--muted)' },
	'.vc-op': {
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		borderRadius: 'var(--radius-pill)',
		padding: '0.1rem 0.45rem',
		flexShrink: '0'
	},
	'.vc-op--insert': {
		background: 'color-mix(in srgb, var(--green) 15%, transparent)',
		color: 'var(--green)'
	},
	'.vc-op--delete': {
		background: 'color-mix(in srgb, var(--red) 15%, transparent)',
		color: 'var(--red)'
	},
	'.vc-x': { color: 'var(--red)', fontSize: 'var(--fs-body)', flexShrink: '0', lineHeight: '1' },
	'.vc-strike': { textDecoration: 'line-through', color: 'var(--muted)' },
	'.vc-line': { fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-body)', color: 'var(--text)' }
}

export const cardStyle: StyleDef = withBrand({ tokens, selectors })
