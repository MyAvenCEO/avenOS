/**
 * The Aven address book — who is who in one shared namespace.
 *
 * Like `reserved-names.ts` this is the real list: an entry means a running
 * Aven with people behind it, never a placeholder to make the page look
 * busy. It stays deliberately thin — a registry answers "who is this and
 * who is behind them", not "what did it do today". The company Aven's
 * mission and services are localised in `$lib/i18n/avens.ts`, keyed by slug.
 */

export type AvenKind = 'person' | 'company'

export interface LiveAven {
	/** The name in front of `.aven.ceo`. */
	slug: string
	/** How it is written: avenSAM, avenCEO. */
	name: string
	kind: AvenKind
	/** The human or the company behind it. */
	holder: string
	/** Which product it runs on. */
	plan: 'avenme' | 'avenceo'
	/** ISO date it went live. */
	since: string
	/** Personal Aven only: the company Aven this human builds toward. */
	worksOn?: string
	/**
	 * Weblink or social profile of the human/vision behind the Aven. WE
	 * activate this (and the bio in i18n/avens.ts) after onboarding — an
	 * entry without one simply shows none yet.
	 */
	link?: { href: string; label: string }
}

export const LIVE_AVENS: LiveAven[] = [
	{
		slug: 'ceo',
		name: 'avenCEO',
		kind: 'company',
		holder: 'avenCEO GmbH',
		plan: 'avenceo',
		since: '2026-01-01',
		link: { href: 'https://aven.ceo', label: 'aven.ceo' }
	},
	{
		slug: 'maia',
		name: 'avenMAIA',
		kind: 'company',
		holder: 'Maia Holding GmbH',
		plan: 'avenceo',
		since: '2026-01-01'
	},
	{
		slug: 'sam',
		name: 'avenSAM',
		kind: 'person',
		holder: 'Samuel Andert',
		plan: 'avenme',
		since: '2026-01-01',
		worksOn: 'avenCEO',
		link: { href: 'https://x.com/samuelandert', label: 'x.com/samuelandert' }
	},
	{
		slug: 'dan',
		name: 'avenDAN',
		kind: 'person',
		holder: 'Daniel Janz',
		plan: 'avenme',
		since: '2026-01-01',
		worksOn: 'avenCEO'
	}
]

export function avensOfKind(kind: AvenKind): LiveAven[] {
	return LIVE_AVENS.filter((a) => a.kind === kind)
}
