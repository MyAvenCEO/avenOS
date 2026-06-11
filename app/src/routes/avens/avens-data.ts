/** Hardcoded example "avens" for the Avens grid (no peer-sync / store yet). */

export type AvenMeta = {
	id: string
	name: string
	subtitle: string
	/** Where the grid card navigates. */
	href: string
}

export const AVENS: AvenMeta[] = [
	{
		id: 'avenVICTORIO',
		name: 'avenVICTORIO',
		subtitle: 'POS journal',
		href: '/avens/avenVICTORIO'
	},
	{
		id: 'avenCEO',
		name: 'avenCEO',
		subtitle: 'Orchestrator',
		href: '/avens/avenCEO'
	},
	{
		id: 'avenMAIA',
		name: 'avenMAIA',
		subtitle: 'Maia City - The Game',
		href: '/avens/avenMAIA'
	},
	{
		id: 'avenSKILLS',
		name: 'avenSKILLS',
		subtitle: 'Agent skills',
		href: '/avens/avenSKILLS'
	}
]

export function avenById(id: string): AvenMeta | undefined {
	const norm = id.trim().toLowerCase()
	return AVENS.find((a) => a.id.toLowerCase() === norm)
}
