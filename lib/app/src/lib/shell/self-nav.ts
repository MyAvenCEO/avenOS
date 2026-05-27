export type SelfNavItem = {
	href: string
	label: string
	match: (path: string) => boolean
}

export type SelfNavSection = {
	title: string
	items: SelfNavItem[]
}

export const selfNavSections: SelfNavSection[] = [
	{
		title: 'Identities',
		items: [
			{
				href: '/self/peers',
				label: 'Peers',
				match: (p) => p.startsWith('/self/peers')
			},
			{
				href: '/self/identity',
				label: 'Self',
				match: (p) => p.startsWith('/self/identity')
			}
		]
	},
	{
		title: 'Sparks',
		items: [
			{
				href: '/self/workspaces',
				label: 'Share',
				match: (p) => p.startsWith('/self/workspaces')
			}
		]
	},
	{
		title: 'Advanced',
		items: [
			{
				href: '/self/advanced/network',
				label: 'Network',
				match: (p) => p.startsWith('/self/advanced/network')
			},
			{ href: '/self/db', label: 'DB', match: (p) => p.startsWith('/self/db') }
		]
	}
]
