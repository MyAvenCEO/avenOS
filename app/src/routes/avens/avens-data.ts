/** Hardcoded example "avens" for the Avens grid (no peer-sync / store yet). */

export type AvenMeta = {
	id: string
	name: string
	/** Eyebrow label shown on the grid card, e.g. "Restaurant", "Game". */
	kind: string
	subtitle: string
	/** Where the grid card navigates. */
	href: string
}

export const AVENS: AvenMeta[] = [
	{
		id: 'avenVICTORIO',
		name: 'avenVICTORIO',
		kind: 'Restaurant',
		subtitle: 'Restaurant · POS journal',
		href: '/avens/avenVICTORIO',
	},
	{
		id: 'avenCEO',
		name: 'avenCEO',
		kind: 'Workspace',
		subtitle: 'Workspace · orchestrator',
		href: '/avens/avenCEO',
	},
	{
		id: 'avenMAIA',
		name: 'avenMAIA',
		kind: 'Game',
		subtitle: 'Maia City - The Game',
		href: '/avens/avenMAIA',
	},
]

export function avenById(id: string): AvenMeta | undefined {
	const norm = id.trim().toLowerCase()
	return AVENS.find((a) => a.id.toLowerCase() === norm)
}
