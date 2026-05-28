export type AvenCityUpgradeIcon =
	| 'small-dome'
	| 'large-dome'
	| 'glamping-dome'
	| 'geo-lodge'
	| 'gathering-dome'
	| 'village-dome'
	| 'settlement-dome'
	| 'grand-lodge'
	| 'apex-citadel'

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
	},
	{
		id: 'gathering-dome',
		level: 5,
		title: 'Gathering Dome',
		description: 'Double-height canvas hall for workshops, meals, and shared lounge space.',
		icon: 'gathering-dome',
		capacity: 8,
		heartCost: 4000,
		locked: true
	},
	{
		id: 'village-dome',
		level: 6,
		title: 'Village Dome',
		description: 'Clustered pods under one shell — private nooks and a central commons.',
		icon: 'village-dome',
		capacity: 12,
		heartCost: 6500,
		locked: true
	},
	{
		id: 'settlement-dome',
		level: 7,
		title: 'Settlement Dome',
		description: 'Climate-controlled megastructure with kitchen wing and maker bay.',
		icon: 'settlement-dome',
		capacity: 16,
		heartCost: 10000,
		locked: true
	},
	{
		id: 'grand-lodge',
		level: 8,
		title: 'Grand Lodge',
		description: 'Flagship geodesic campus with amphitheater, spa circuit, and event deck.',
		icon: 'grand-lodge',
		capacity: 24,
		heartCost: 18000,
		locked: true
	},
	{
		id: 'apex-citadel',
		level: 9,
		title: 'Apex Citadel',
		description: 'Continental-scale dome district — transit hub, gardens, and summit halls.',
		icon: 'apex-citadel',
		capacity: 32,
		heartCost: 25000,
		locked: true
	}
]

export function formatHeartCostShort(cost: number): string {
	if (cost < 1000) return String(cost)
	const thousands = cost / 1000
	if (Number.isInteger(thousands)) return `${thousands}k`
	return `${thousands.toFixed(1).replace(/\.0$/, '')}k`
}

export function isUpgradeLocked(upgrade: AvenCityUpgrade): boolean {
	return upgrade.level >= 4
}

export function upgradeById(id: string): AvenCityUpgrade {
	return AVENCITY_UPGRADES.find((u) => u.id === id) ?? AVENCITY_UPGRADES[0]
}
