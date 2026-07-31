/**
 * The camera rig — one scheme, the city-builder one, shared by the world and
 * the sandbox.
 *
 * It follows what Age of Empires, Anno and Cities: Skylines settled on:
 *   · WASD / arrow keys travel the map
 *   · the wheel zooms toward whatever the cursor is over
 *   · drag turns and tilts, right-drag slides, Q/E turn from the keyboard
 *   · a click stays a click, so it can still select
 *
 * The two gestures stay strictly separate: dragging sets the ANGLE and the
 * wheel sets the DISTANCE. Coupling them (zooming in also tilting toward eye
 * level, the way Cities: Skylines does) reads as the camera fighting you once
 * you have chosen an angle you want to keep.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

export interface CameraRigOptions {
	minDistance?: number
	maxDistance?: number
	/** world units per second of keyboard travel */
	moveSpeed?: number
	/** where the camera looks when the rig starts */
	target?: THREE.Vector3
	/** the camera never drops below this height — no going under the board */
	floorY?: number
	/** false locks the view to orbiting one fixed point (the sandbox) */
	freeMove?: boolean
}

export interface CameraRig {
	controls: OrbitControls
	/** call once per frame with the frame delta in seconds */
	update(dt: number): void
	dispose(): void
}

const PAN_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])
const TURN_KEYS = new Set(['q', 'e'])
const TURN_SPEED = 1.4

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function createCameraRig(
	camera: THREE.PerspectiveCamera,
	dom: HTMLElement,
	options: CameraRigOptions = {}
): CameraRig {
	const minDistance = options.minDistance ?? 1.2
	const maxDistance = options.maxDistance ?? 300
	const freeMove = options.freeMove ?? true
	const floorY = options.floorY ?? 0
	const speed = options.moveSpeed ?? 26

	const controls = new OrbitControls(camera, dom)
	controls.enableDamping = true
	controls.dampingFactor = 0.08
	controls.minDistance = minDistance
	controls.maxDistance = maxDistance
	controls.minPolarAngle = 0.05
	controls.maxPolarAngle = Math.PI * 0.495
	controls.screenSpacePanning = false
	// zoom lands where you are pointing, the way every map does
	controls.zoomToCursor = true
	// drag turns and tilts; right-drag slides the map; a click is still a click
	controls.mouseButtons = {
		LEFT: THREE.MOUSE.ROTATE,
		MIDDLE: THREE.MOUSE.DOLLY,
		RIGHT: THREE.MOUSE.PAN
	}
	controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }
	if (options.target) controls.target.copy(options.target)

	if (!freeMove) {
		// a specimen turntable: look at it from any angle, never leave it
		controls.enablePan = false
		controls.mouseButtons.RIGHT = null
		controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE
	}

	const held = new Set<string>()
	const forward = new THREE.Vector3()
	const right = new THREE.Vector3()
	const move = new THREE.Vector3()
	const spherical = new THREE.Spherical()
	const offset = new THREE.Vector3()

	/** Swings the view around its focus point — the Q/E keys. */
	function turn(radians: number): void {
		offset.copy(camera.position).sub(controls.target)
		spherical.setFromVector3(offset)
		spherical.theta += radians
		camera.position.copy(controls.target).add(offset.setFromSpherical(spherical))
	}

	function onKeyDown(e: KeyboardEvent): void {
		if (e.metaKey || e.ctrlKey || e.altKey) return
		const target = e.target as HTMLElement | null
		if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
		const k = e.key.toLowerCase()
		if (!TURN_KEYS.has(k) && !(freeMove && PAN_KEYS.has(k))) return
		held.add(k)
		e.preventDefault()
	}

	function onKeyUp(e: KeyboardEvent): void {
		held.delete(e.key.toLowerCase())
	}

	/** Losing focus must not leave a key stuck down mid-travel. */
	function onBlur(): void {
		held.clear()
	}

	window.addEventListener('keydown', onKeyDown)
	window.addEventListener('keyup', onKeyUp)
	window.addEventListener('blur', onBlur)

	function update(dt: number): void {
		const step = Math.min(dt, 0.05)

		if (held.has('q')) turn(TURN_SPEED * step)
		if (held.has('e')) turn(-TURN_SPEED * step)

		if (freeMove && held.size > 0) {
			camera.getWorldDirection(forward)
			forward.y = 0
			if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
			forward.normalize()
			right.crossVectors(forward, camera.up).normalize()

			move.set(0, 0, 0)
			if (held.has('w') || held.has('arrowup')) move.add(forward)
			if (held.has('s') || held.has('arrowdown')) move.sub(forward)
			if (held.has('d') || held.has('arrowright')) move.add(right)
			if (held.has('a') || held.has('arrowleft')) move.sub(right)

			if (move.lengthSq() > 0) {
				// travel scales with how far out you are: a step that feels right
				// on the board view would be a teleport at ground level
				const zoomScale = Math.max(0.08, camera.position.distanceTo(controls.target) / 60)
				move.normalize().multiplyScalar(speed * zoomScale * step)
				camera.position.add(move)
				controls.target.add(move)
			}
		}

		controls.update()

		// never let the view sink under the ground — orbiting low, travelling
		// downhill or dollying in all try to, and the world has no underside
		if (camera.position.y < floorY) {
			camera.position.y = floorY
			if (controls.target.y < floorY) controls.target.y = floorY
		}
	}

	return {
		controls,
		update,
		dispose(): void {
			window.removeEventListener('keydown', onKeyDown)
			window.removeEventListener('keyup', onKeyUp)
			window.removeEventListener('blur', onBlur)
			controls.dispose()
		}
	}
}
