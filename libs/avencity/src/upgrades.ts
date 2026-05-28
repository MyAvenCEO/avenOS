export type AvenCityUpgradeIcon = 'small-dome' | 'large-dome' | 'glamping-dome' | 'geo-lodge'

export type AvenCityUpgrade = {
	id: string
	level: number
	title: string
	description: string
	icon: AvenCityUpgradeIcon
	capacity: number
	heartCost: number
	locked?: boolean
}

export const AVENCITY_UPGRADES: AvenCityUpgrade[] = [
	{
		id: 'small-dome',
		level: 1,
		title: 'Small Dome Tent',
		description: 'A compact canvas shelter for one explorer and a bedroll.',
		icon: 'small-dome',
		capacity: 2,
		heartCost: 250
	},
	{
		id: 'large-dome',
		level: 2,
		title: 'Large Dome Tent',
		description: 'Room for gear, friends, and a proper camp table inside.',
		icon: 'large-dome',
		capacity: 3,
		heartCost: 500
	},
	{
		id: 'glamping-dome',
		level: 3,
		title: 'Glamping Dome',
		description: 'Insulated panels, viewport skylight, and off-grid comfort.',
		icon: 'glamping-dome',
		capacity: 4,
		heartCost: 1000
	},
	{
		id: 'geo-lodge',
		level: 4,
		title: 'Geo Lodge',
		description: 'Permanent geodesic base with terrace deck and power hookup.',
		icon: 'geo-lodge',
		capacity: 6,
		heartCost: 2500,
		locked: true
	}
]

export function upgradeById(id: string): AvenCityUpgrade {
	return AVENCITY_UPGRADES.find((u) => u.id === id) ?? AVENCITY_UPGRADES[0]
}
