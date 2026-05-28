import type { Camera } from 'three'
import { Vector3 } from 'three'

const vec = new Vector3()

export function clientToWorldXY(
	clientX: number,
	clientY: number,
	canvas: HTMLCanvasElement,
	camera: Camera
): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect()
	const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
	const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
	vec.set(ndcX, ndcY, 0)
	vec.unproject(camera)
	return { x: vec.x, y: vec.y }
}
