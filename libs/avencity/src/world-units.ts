import type { Camera } from 'three'
import { OrthographicCamera, Vector3 } from 'three'

import { AVENCITY_UPGRADES } from './upgrades'

const edgeLeft = new Vector3()
const edgeRight = new Vector3()

/** Convert world-space units to screen pixels for the active camera. */
export function worldUnitsToPx(units: number, camera: Camera, viewportHeight: number): number {
	if (camera instanceof OrthographicCamera) {
		const viewHeight = camera.top - camera.bottom
		if (viewHeight > 0) return (units / viewHeight) * viewportHeight
		return units * camera.zoom
	}
	return units * 80
}

/** Project a world-space circle diameter to screen pixels (matches WebGL circle size). */
export function circleDiameterPx(
	radius: number,
	camera: Camera,
	viewport: { width: number; height: number }
): number {
	edgeLeft.set(-radius, 0, 0)
	edgeRight.set(radius, 0, 0)
	edgeLeft.project(camera)
	edgeRight.project(camera)
	return Math.abs(edgeRight.x - edgeLeft.x) * (viewport.width / 2)
}

export function circleIconPx(
	radius: number,
	camera: Camera,
	viewport: { width: number; height: number },
	fillRatio = 0.75
): number {
	return circleDiameterPx(radius, camera, viewport) * fillRatio
}

const MIN_DOME_M = AVENCITY_UPGRADES[0].domeDiameterM
const MAX_DOME_M = AVENCITY_UPGRADES[AVENCITY_UPGRADES.length - 1].domeDiameterM
const MIN_RADIUS = 0.11
const MAX_RADIUS = 0.54
const LOG_MIN = Math.log(MIN_DOME_M)
const LOG_MAX = Math.log(MAX_DOME_M)

/** Target node radius per upgrade level — scales with geodesic diameter. */
export function radiusForUpgradeLevel(level: number): number {
	const upgrade = AVENCITY_UPGRADES[Math.min(Math.max(level - 1, 0), AVENCITY_UPGRADES.length - 1)]
	const t = (Math.log(upgrade.domeDiameterM) - LOG_MIN) / (LOG_MAX - LOG_MIN)
	return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS)
}

export const CIRCLE_GROWTH_SPEED = 1.65

/** Start at half the target size, then grow into the level radius. */
export function spawnRadiusForLevel(level: number): number {
	return radiusForUpgradeLevel(level) * 0.5
}

export const PANEL_POINTER_GAP_PX = 6
