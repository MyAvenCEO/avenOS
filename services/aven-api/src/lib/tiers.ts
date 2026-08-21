/**
 * The tiers a visitor can arrive from, and how to greet each one.
 *
 * The marketing site owns pricing; this file owns only what the funnel needs
 * to say back to someone who clicked a particular button. Keeping it here
 * rather than importing `plans.ts` is deliberate — the two apps build
 * separately, and a stale copy of prices is worse than no copy at all, so
 * there are no prices in it.
 */
export type TierId = 'avenid' | 'avenme' | 'avenceo' | 'avencoop'

export const TIER_IDS: TierId[] = ['avenid', 'avenme', 'avenceo', 'avencoop']

export interface TierGreeting {
	name: string
	/** Why securing an avenID is the way into THIS tier. */
	lead: string
}

const GREETINGS: Record<TierId, TierGreeting> = {
	avenid: {
		name: 'avenID',
		lead: 'Deine avenID ist der Name, unter dem dein Aven erreichbar ist — und zugleich dein Platz auf der Warteliste. Eingeladen wird der Reihe nach.'
	},
	avenme: {
		name: 'avenME',
		lead: 'avenME startet invite‑only. Deinen Platz sicherst du dir über deine avenID: Der Name gehört dir, und die Reihenfolge der Warteliste ist die Reihenfolge der Einladungen.'
	},
	avenceo: {
		name: 'avenCEO',
		lead: 'avenCEO startet invite‑only. Deinen Platz sicherst du dir über deine avenID: Der Name gehört dir, und die Reihenfolge der Warteliste ist die Reihenfolge der Einladungen.'
	},
	avencoop: {
		name: 'avenCOOP',
		lead: 'avenCOOP vergeben wir nach Passung, nicht der Reihe nach — wir steigen als technischer Co‑Founder bei dir ein. Der Weg dahin führt trotzdem über deine avenID: Sie hält deinen Platz und zeigt uns, dass es dir ernst ist.'
	}
}

export function tierFrom(url: URL): TierId | null {
	const raw = url.searchParams.get('tier')
	return TIER_IDS.includes(raw as TierId) ? (raw as TierId) : null
}

export function greetingFor(tier: TierId | null): TierGreeting | null {
	return tier ? GREETINGS[tier] : null
}
