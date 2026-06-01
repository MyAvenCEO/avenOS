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
	/** Max residents / guests the dome supports. */
	capacity: number
	heartCost: number
	/** Geodesic shell diameter in metres (shown in UI). */
	domeDiameterM: number
	locked?: boolean
}

export const AVENCITY_UPGRADES: AvenCityUpgrade[] = [
	// Hearts: steep exponential 1 k → 18 M (levels 7–9: 6 M / 12 M / 18 M).
	{
		id: 'small-dome',
		level: 1,
		title: 'Small Dome Tent',
		description:
			'A compact canvas geodesic for two — bedroll, pack, skylight flap, and a wide viewport to the stars above the ridge.',
		icon: 'small-dome',
		capacity: 2,
		heartCost: 1_000,
		domeDiameterM: 5
	},
	{
		id: 'large-dome',
		level: 2,
		title: 'Large Dome Tent',
		description:
			'A wider shell with headroom for three — camp table, gear loft, stove nook, and shared warmth through cold alpine nights.',
		icon: 'large-dome',
		capacity: 3,
		heartCost: 8_000,
		domeDiameterM: 7
	},
	{
		id: 'glamping-dome',
		level: 3,
		title: 'Glamping Dome',
		description:
			'Insulated geodesic panels, full skylight, and off-grid comfort for four — queen bed, kitchenette, and a private deck ring.',
		icon: 'glamping-dome',
		capacity: 4,
		heartCost: 35_000,
		domeDiameterM: 10
	},
	{
		id: 'geo-lodge',
		level: 4,
		title: 'Geo Lodge',
		description:
			'Permanent geodesic base with terrace deck, power hookup, rainwater catchment, and room for six under one weatherproof shell.',
		icon: 'geo-lodge',
		capacity: 6,
		heartCost: 150_000,
		domeDiameterM: 14,
		locked: true
	},
	{
		id: 'gathering-dome',
		level: 5,
		title: 'Gathering Dome',
		description:
			'Double-height geodesic hall for eight — workshop bays, shared kitchen, lounge arc, and flexible seating for community gatherings.',
		icon: 'gathering-dome',
		capacity: 8,
		heartCost: 650_000,
		domeDiameterM: 18,
		locked: true
	},
	{
		id: 'village-dome',
		level: 6,
		title: 'Village Dome',
		description:
			'Clustered pods under an expanding shell — private sleeping nooks, maker corner, bath wing, and a central commons for sixteen residents.',
		icon: 'village-dome',
		capacity: 16,
		heartCost: 2_500_000,
		domeDiameterM: 28,
		locked: true
	},
	{
		id: 'settlement-dome',
		level: 7,
		title: 'Settlement Dome',
		description:
			'Climate-controlled megadome with kitchen wing, maker bay, laundry loop, and private quarters for thirty-two under one breathable roof.',
		icon: 'settlement-dome',
		capacity: 32,
		heartCost: 6_000_000,
		domeDiameterM: 42,
		locked: true
	},
	{
		id: 'grand-lodge',
		level: 8,
		title: 'Grand Lodge',
		description:
			'Flagship geodesic campus — amphitheater bowl, spa circuit, event deck, and hospitality suites for sixty-four across linked domes.',
		icon: 'grand-lodge',
		capacity: 64,
		heartCost: 12_000_000,
		domeDiameterM: 64,
		locked: true
	},
	{
		id: 'apex-citadel',
		level: 9,
		title: 'Apex Citadel',
		description:
			'Stadium-scale geodesic district for 132 — transit hub, summit halls, market arcades, and a vast indoor permaculture forest under one sky.',
		icon: 'apex-citadel',
		capacity: 132,
		heartCost: 18_000_000,
		domeDiameterM: 120,
		locked: true
	}
]

export function formatHeartCostShort(cost: number): string {
	if (cost < 1000) return String(cost)
	if (cost >= 1_000_000) {
		const millions = cost / 1_000_000
		if (Number.isInteger(millions)) return `${millions}M`
		return `${millions.toFixed(1).replace(/\.0$/, '')}M`
	}
	const thousands = cost / 1000
	if (Number.isInteger(thousands)) return `${thousands}k`
	return `${thousands.toFixed(1).replace(/\.0$/, '')}k`
}

export function formatHeartCostFull(cost: number): string {
	return cost.toLocaleString('en-US')
}

export function formatDomeDiameter(diameterM: number): string {
	if (diameterM >= 100) return `Ø ${Math.round(diameterM)} m`
	return `Ø ${diameterM} m`
}

export function isUpgradeLocked(upgrade: AvenCityUpgrade): boolean {
	return upgrade.level >= 4
}

export function upgradeById(id: string): AvenCityUpgrade {
	return AVENCITY_UPGRADES.find((u) => u.id === id) ?? AVENCITY_UPGRADES[0]
}
