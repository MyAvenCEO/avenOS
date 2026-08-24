/**
 * SvelteKit-facing surface of the pricing SSOT. The data and the pure
 * helpers live in `@avenos/aven-brand/pricing` (re-exported via
 * plans-data.ts); this file re-exports them and adds only what needs `$lib`.
 */

import { idFunnelHref } from '$lib/id-service'
import type { Plan } from './plans-data'

export * from './plans-data'

/** Book it, or apply for it — avenCOOP is a decision we make together. */
export function ctaLabel(p: Plan): string {
	if (p.applyOnly) return 'Bewerben'
	return p.id === 'avenid' ? 'avenID sichern' : 'Jetzt auf Warteliste setzen'
}

export function ctaHref(p: Plan): string {
	return idFunnelHref(p.id)
}
