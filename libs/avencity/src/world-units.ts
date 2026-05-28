import type { Camera } from 'three'
import { OrthographicCamera, Vector3 } from 'three'

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

/** Target node radius per upgrade level (world units). Level 1 is 2× the prior base size. */
export function radiusForUpgradeLevel(level: number): number {
	const radii = [0.22, 0.32, 0.42, 0.54]
	return radii[Math.min(Math.max(level - 1, 0), radii.length - 1)]
}

export const CIRCLE_GROWTH_SPEED = 2.8

/** Spawn small, then grow into the level target radius. */
export function spawnRadiusForLevel(level: number): number {
	return radiusForUpgradeLevel(level) * 0.45
}

export const PANEL_POINTER_GAP_PX = 6
