import { hexKey } from './hex-grid'
import { AVENCITY_UPGRADES } from './upgrades'

export type Plot = {
	id: string
	q: number
	r: number
	upgradeId: string
}

export function createInitialPlotMap(): Plot[] {
	return [
		{
			id: hexKey(0, 0),
			q: 0,
			r: 0,
			upgradeId: AVENCITY_UPGRADES[0].id
		}
	]
}

export function addPlotAt(
	plots: Plot[],
	q: number,
	r: number,
	upgradeId = AVENCITY_UPGRADES[0].id
): Plot[] {
	const key = hexKey(q, r)
	if (plots.some((plot) => hexKey(plot.q, plot.r) === key)) return plots
	return [...plots, { id: key, q, r, upgradeId }]
}
