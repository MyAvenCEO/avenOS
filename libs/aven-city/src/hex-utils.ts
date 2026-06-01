import type { Camera } from 'three'
import { Vector3 } from 'three'

const point = new Vector3()

const SQRT3 = Math.sqrt(3)

/** Flat-top hex corners — flat edge at the bottom on screen (Catan-style). */
export function hexCornerPoints(radius: number, target: Vector3[] = []): Vector3[] {
	target.length = 0
	for (let i = 0; i < 6; i += 1) {
		const angle = (Math.PI / 3) * i
		point.set(radius * Math.cos(angle), radius * Math.sin(angle), 0)
		target.push(point.clone())
	}
	return target
}

/** Flat-top hex height in world units (center → flat edge × 2). */
export function hexHeight(radius: number): number {
	return radius * SQRT3
}

/** Projected vertical span of the hex (world units → screen px). */
export function hexVerticalSpanPx(
	radius: number,
	camera: Camera,
	viewport: { width: number; height: number }
): number {
	const halfHeight = hexHeight(radius) / 2
	const top = new Vector3(0, -halfHeight, 0)
	const bottom = new Vector3(0, halfHeight, 0)
	top.project(camera)
	bottom.project(camera)
	return Math.abs(top.y - bottom.y) * (viewport.height / 2)
}

export function hexViewBoxSize(radius: number): { width: number; height: number; minY: number } {
	return { width: radius * 2, height: hexHeight(radius), minY: -hexHeight(radius) / 2 }
}

/** Hex circumradius for the initial map view (fixed world size after first layout). */
export function hexCircumradiusForViewport(
	camera: Camera,
	viewport: { width: number; height: number },
	screenFillRatio = 0.8
): number {
	const targetPx = Math.min(viewport.width, viewport.height) * screenFillRatio
	let lo = 0.001
	let hi = 500

	for (let i = 0; i < 48; i += 1) {
		const mid = (lo + hi) / 2
		if (hexVerticalSpanPx(mid, camera, viewport) < targetPx) lo = mid
		else hi = mid
	}

	return (lo + hi) / 2
}

export function hexPolygonPointsAttr(radius: number): string {
	return hexCornerPoints(radius)
		.map((p) => `${p.x},${p.y}`)
		.join(' ')
}
