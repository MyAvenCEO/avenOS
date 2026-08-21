/**
 * Where the avenID funnel lives.
 *
 * The marketing site sells the tiers; the id service takes the money and the
 * name. So every CTA here is a deep link into that service, carrying the tier
 * whose button was pressed — which is how a hold records where someone came
 * from instead of us guessing later.
 *
 * `PUBLIC_ID_BASE_URL` overrides the host at build time (point it at
 * http://localhost:5173 to work against a local `bun run dev:api:designer`).
 * The default is the next environment, the same host the desktop app uses.
 */
const BASE =
	(import.meta.env.PUBLIC_ID_BASE_URL as string | undefined) ?? 'https://id.next.aven.ceo'

/** The funnel entry, optionally pre-filled with a name and tagged with a tier. */
export function idFunnelHref(tier?: string, preferredName?: string): string {
	const query = new URLSearchParams()
	if (tier) query.set('tier', tier)
	if (preferredName) query.set('name', preferredName)
	const suffix = query.size > 0 ? `?${query}` : ''
	return `${BASE.replace(/\/$/, '')}/${suffix}`
}
