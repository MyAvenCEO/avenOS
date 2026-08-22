/**
 * THE reserved avenIDs — the real list, and the only one the site renders.
 *
 * Every name here is a name somebody actually holds. Nothing on this page is
 * decoration: a "recently secured" row invented to look busy is fabricated
 * social proof, and the one thing an avenID promises is that a name means
 * something. So this file stays honest — add an entry when a name is really
 * taken, never to fill the row out.
 *
 * `since` is the ISO date the name was secured; the site shows the newest
 * first and never invents one.
 */
export interface ReservedName {
	/** The name itself — what sits in front of `.aven.ceo`. */
	slug: string
	since: string
	/** Optional: whose Aven answers to it, where that is public anyway. */
	holder?: string
}

/**
 * Seeded with the names the site already speaks publicly: the two company
 * Aven (avenMAIA for the Maia Holding GmbH, avenCEO for the avenCEO GmbH) and
 * the founders' personal Aven (avenSAM, avenDAN) — one shared namespace for
 * people and companies. Add real reservations underneath.
 */
export const RESERVED_NAMES: ReservedName[] = [
	{ slug: 'maia', since: '2026-01-01', holder: 'avenMAIA' },
	{ slug: 'ceo', since: '2026-01-01', holder: 'avenCEO' },
	{ slug: 'sam', since: '2026-01-01', holder: 'avenSAM' },
	{ slug: 'dan', since: '2026-01-01', holder: 'avenDAN' }
]

/**
 * The waiting list, in the order it was actually formed — oldest first, so a
 * name's position IS its place in the queue. "Wer zuerst kommt, gründet
 * zuerst" is the whole promise; a feed sorted newest-first would show the
 * queue backwards.
 */
export function reservedInOrder(): ReservedName[] {
	return [...RESERVED_NAMES].sort((a, b) => a.since.localeCompare(b.since))
}

/** The next free place — one past the last one taken. */
export function nextPosition(): number {
	return RESERVED_NAMES.length + 1
}
