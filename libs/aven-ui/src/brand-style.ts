import { vibeTokens } from '@myavenceo/aven-ceo/tokens'
import type { StyleDef } from '@myavenceo/aven-vibes'

/**
 * Shared brand design system for all vibe views.
 *
 * `brandTokens` is the flat token map the StyleEngine flattens onto `:host` as
 * CSS custom properties (`text` -> `--text`), so any vibe selector can reference
 * `var(--text)`, `var(--radius-card)`, `var(--pad-card)`, etc.
 *
 * It used to be a local `brand.style.json` described as "a mirror of the app's
 * app.css tokens" and kept in step by hand. It was not: the vibe layer sat on
 * the retired Chillax stack long after the app moved to Inter, on a gold
 * (`#e6b34d`) that was not the brand's sunflower, and on a green (`#2e7d52`)
 * that existed in no palette at all. The map is now derived from the one
 * palette in `@myavenceo/aven-ceo`, so those three cannot come back.
 *
 * `brandBaseSelectors` are the reset + `:host` + reusable primitives (`.card`,
 * `.eyebrow`, `.btn`/`.btn-secondary`) every vibe shares so cards, paddings,
 * radii, type sizes and spacing stay identical across templates.
 *
 * Vibes compose with `withBrand({ tokens, selectors })`, which merges the brand
 * tokens/selectors UNDER the vibe's own (vibe values win on conflict).
 */
export const brandTokens: Record<string, string> = vibeTokens

export const brandBaseSelectors: Record<string, Record<string, unknown>> = {
	'*, *::before, *::after': { boxSizing: 'border-box' },
	':host': {
		fontFamily: 'var(--font-sans)',
		background: 'var(--bg-a)',
		color: 'var(--text)',
		margin: '0',
		minHeight: '100%',
		height: '100%',
		letterSpacing: '-0.011em'
	},

	/* Outer shell — one standardized max width + padding for every template. */
	'.brand-shell': {
		maxWidth: 'var(--max-w)',
		margin: '0 auto',
		padding: 'var(--pad-card)',
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap-section)'
	},

	/* Reference card: rounded-xl, subtle border, translucent cream, p-6. */
	'.card': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: 'var(--pad-card)'
	},
	'.card-sm': {
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-inner)',
		padding: 'var(--pad-card-sm)'
	},

	/* Grid card — the docs-landing tile pattern (icon chip · title · description ·
	 * optional action). Reusable across the design system for any card grid. */
	'.grid-card': {
		display: 'flex',
		flexDirection: 'column',
		gap: 'var(--gap-tight)',
		background: 'var(--surface)',
		border: '1px solid var(--border)',
		borderRadius: 'var(--radius-card)',
		padding: 'var(--pad-card)'
	},
	'.grid-card-icon': {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '2.5rem',
		height: '2.5rem',
		marginBottom: '0.5rem',
		borderRadius: 'var(--radius-pill)',
		border: '1px solid var(--border)',
		color: 'var(--muted-strong)'
	},
	'.grid-card-title': {
		fontSize: 'var(--fs-title)',
		fontWeight: '500',
		color: 'var(--text)'
	},
	'.grid-card-desc': {
		fontSize: 'var(--fs-body)',
		lineHeight: '1.5',
		color: 'var(--muted)'
	},
	'.grid-card-action': {
		marginTop: '0.25rem',
		fontSize: 'var(--fs-micro)',
		fontWeight: '600',
		letterSpacing: 'var(--tracking-eyebrow)',
		textTransform: 'uppercase',
		color: 'var(--muted)'
	},

	/* Uppercase tracked eyebrow label (11px, muted). */
	'.eyebrow': {
		fontSize: 'var(--fs-eyebrow)',
		fontWeight: '500',
		letterSpacing: 'var(--tracking-eyebrow)',
		textTransform: 'uppercase',
		color: 'var(--muted)'
	},

	/* Buttons: primary stays brand navy; secondary is the cream/yellow fill. */
	'.btn': {
		display: 'inline-flex',
		alignItems: 'center',
		justifyContent: 'center',
		gap: '0.5rem',
		borderRadius: 'var(--radius-pill)',
		padding: '0.625rem 1.1rem',
		fontSize: 'var(--fs-body)',
		fontWeight: '500',
		border: '1px solid transparent',
		cursor: 'pointer',
		background: 'var(--primary)',
		color: 'var(--primary-foreground)'
	},
	'.btn-secondary': {
		background: 'var(--secondary)',
		color: 'var(--secondary-foreground)',
		border: '1px solid color-mix(in srgb, var(--secondary-foreground) 14%, transparent)'
	}
}

function mergeDeep(
	base: Record<string, unknown>,
	over: Record<string, unknown>
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base }
	for (const key of Object.keys(over)) {
		const ov = over[key]
		const bv = out[key]
		if (
			ov &&
			typeof ov === 'object' &&
			!Array.isArray(ov) &&
			bv &&
			typeof bv === 'object' &&
			!Array.isArray(bv)
		) {
			out[key] = mergeDeep(bv as Record<string, unknown>, ov as Record<string, unknown>)
		} else {
			out[key] = ov
		}
	}
	return out
}

/**
 * Compose a vibe StyleDef on top of the shared brand layer. Brand tokens and
 * base selectors form the foundation; the vibe's own tokens/selectors override
 * on conflict and add its bespoke classes.
 */
export function withBrand(style: StyleDef): StyleDef {
	return {
		tokens: mergeDeep(brandTokens, (style.tokens ?? {}) as Record<string, unknown>),
		components: style.components,
		selectors: mergeDeep(
			brandBaseSelectors,
			(style.selectors ?? {}) as Record<string, unknown>
		) as Record<string, Record<string, unknown>>
	}
}
