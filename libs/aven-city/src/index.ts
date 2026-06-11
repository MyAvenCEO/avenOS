export { default as AvenCityGame } from './AvenCityGame.svelte'
export {
	axialToWorld,
	expansionCandidates,
	type HexCoord,
	hexKey,
	nearestExpansionCandidate
} from './hex-grid'
export { addPlotAt, createInitialPlotMap, type Plot } from './plot-map'
export {
	AVENCITY_UPGRADES,
	type AvenCityUpgrade,
	formatDomeDiameter,
	formatHeartCostFull,
	formatHeartCostShort,
	isUpgradeLocked,
	upgradeById
} from './upgrades'
