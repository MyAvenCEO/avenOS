/**
 * Scene shell: renderer, camera, lights, sea, world mounting and picking.
 *
 * Client-only — import dynamically from onMount. The sky color here must
 * match --color-sky in tokens.css so canvas and page blend seamlessly.
 */
import * as THREE from 'three'
import { generateMap, type HexTile } from '../hexmap'
import {
	buildWorld,
	EMPTY_STATS,
	type PlacedKind,
	type WorldApi,
	type WorldStats,
	type Zone
} from './buildWorld'
import { createCameraRig } from './cameraRig'
import { createDaylight } from './daylight'

const SKY = '#cde9ec'
const HEX_HEIGHT = 0.5 // keep in sync with buildWorld
const WATER_LEVEL = 0.3 // sea surface laps against the island walls

/**
 * Super-simple faceted low-poly sea: a static displaced plane with flat
 * shading — zero shader cost, zero per-frame work, instant load. Vertices
 * displace by a position-hash (coincident verts move together) so the
 * surface stays watertight while the triangles catch the light.
 */
function buildSimpleSea(size: number): THREE.Mesh {
	const geo = new THREE.PlaneGeometry(size, size, 110, 110).toNonIndexed()
	geo.rotateX(-Math.PI / 2)
	const pos = geo.getAttribute('position')
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i)
		const z = pos.getZ(i)
		const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
		pos.setY(i, (h - Math.floor(h)) * 0.09)
	}
	geo.computeVertexNormals()
	const mesh = new THREE.Mesh(
		geo,
		new THREE.MeshStandardMaterial({
			color: '#5fa9bc',
			roughness: 0.65,
			metalness: 0,
			flatShading: true
		})
	)
	mesh.position.y = WATER_LEVEL - 0.09
	mesh.receiveShadow = true
	return mesh
}

export interface SceneApi {
	setWorld(seed: number): void
	/** Founds a settlement level or a works on a hex, replacing what stood. */
	placeBuilding(tile: HexTile, kind: PlacedKind): void
	removeBuilding(tile: HexTile): void
	buildingAt(tile: HexTile): PlacedKind | null
	/** Everyone housed across the island. */
	population(): number
	/** What has been built across the island, in people and hectares. */
	stats(): WorldStats
	/** Designates hexes for a use, and shows or hides the colour wash that
	 * makes the designation readable on the island. */
	setZone(tiles: readonly HexTile[], zone: Zone): void
	zoneAt(tile: HexTile): Zone
	showZones(on: boolean): void
	/** Moves the sun to the given hour of the day (0..24). */
	setHour(hour: number): void
	dispose(): void
}

export interface SceneOptions {
	/** Fires with everything currently selected — empty when nothing is. */
	onSelect?(tiles: HexTile[]): void
}

function disposeObject(root: THREE.Object3D): void {
	root.traverse((obj) => {
		if (obj instanceof THREE.Mesh) {
			obj.geometry.dispose()
			const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
			for (const m of mats) m.dispose()
		}
	})
}

/** Slim, semi-transparent ring around a selected hex — present, not loud. */
function makeSelectionRingGeometry(): THREE.BufferGeometry {
	const shape = new THREE.Shape()
	const hole = new THREE.Path()
	for (let i = 0; i < 6; i++) {
		const a = (Math.PI / 3) * i
		const target = i === 0 ? 'moveTo' : 'lineTo'
		shape[target](Math.cos(a) * 0.99, Math.sin(a) * 0.99)
		hole[target](Math.cos(a) * 0.93, Math.sin(a) * 0.93)
	}
	shape.closePath()
	hole.closePath()
	shape.holes.push(hole)
	const geo = new THREE.ExtrudeGeometry(shape, {
		depth: 0.012,
		bevelEnabled: true,
		bevelThickness: 0.008,
		bevelSize: 0.008,
		bevelSegments: 2
	})
	geo.rotateX(-Math.PI / 2)
	return geo
}

/**
 * The box you drag to select a span of hexes. It lives in the DOM rather
 * than the scene: a selection marquee belongs to the screen, not the world,
 * so it should not tilt with the camera.
 */
function makeMarquee(parent: HTMLElement): HTMLDivElement {
	const box = document.createElement('div')
	box.style.cssText = [
		'position:absolute',
		'pointer-events:none',
		'display:none',
		'border:1.5px solid rgba(255,253,246,0.95)',
		'background:rgba(255,253,246,0.16)',
		'border-radius:4px',
		'box-shadow:0 2px 10px rgba(58,74,80,0.25)',
		'z-index:5'
	].join(';')
	parent.appendChild(box)
	return box
}

export function createScene(canvas: HTMLCanvasElement, options: SceneOptions = {}): SceneApi {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFShadowMap
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.05

	const scene = new THREE.Scene()
	scene.background = new THREE.Color(SKY)
	scene.fog = new THREE.Fog(SKY, 620, 1500)

	const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2600)
	camera.position.set(190, 185, 255)

	const rig = createCameraRig(camera, canvas, {
		// close enough to stand among the domes of a single hex
		minDistance: 0.35,
		maxDistance: 900,
		// eye height stays above the board, so you can walk the island but
		// never end up under it looking at the sea from below
		floorY: HEX_HEIGHT + 0.12,
		moveSpeed: 52
	})
	const controls = rig.controls

	const daylight = createDaylight(scene, { shadowExtent: 90, shadowFar: 280 })

	// the sea — simple faceted low-poly, static
	const sea = buildSimpleSea(1700)
	scene.add(sea)

	// selection rings: one instanced mesh, so selecting a hundred hexes costs
	// the same draw as selecting one
	const ringGeometry = makeSelectionRingGeometry()
	const ringMaterial = new THREE.MeshStandardMaterial({
		color: '#fffdf6',
		roughness: 0.6,
		metalness: 0,
		transparent: true,
		opacity: 0.75
	})
	let rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, 1024)
	rings.frustumCulled = false
	rings.count = 0
	scene.add(rings)

	/**
	 * Grows the ring mesh to hold a selection.
	 *
	 * An instanced mesh is allocated once at a fixed size, so a fixed size is a
	 * silent cap: a span across the whole island drew its first few hundred
	 * hexes and simply left the rest unmarked, while the count in the HUD said
	 * otherwise. It now doubles until it fits.
	 */
	function ensureRings(needed: number): void {
		if (needed <= rings.instanceMatrix.count) return
		let size = rings.instanceMatrix.count
		while (size < needed) size *= 2
		scene.remove(rings)
		rings.dispose()
		rings = new THREE.InstancedMesh(ringGeometry, ringMaterial, size)
		rings.frustumCulled = false
		rings.count = 0
		scene.add(rings)
	}

	const marquee = makeMarquee(canvas.parentElement ?? document.body)
	let selection: HexTile[] = []

	function showSelection(): void {
		const m = new THREE.Matrix4()
		const offset = world?.group.position ?? new THREE.Vector3()
		ensureRings(selection.length)
		for (let i = 0; i < selection.length; i++) {
			const t = selection[i]
			m.makeTranslation(t.x + offset.x, HEX_HEIGHT + 0.01, t.z + offset.z)
			rings.setMatrixAt(i, m)
		}
		rings.count = selection.length
		rings.instanceMatrix.needsUpdate = true
		options.onSelect?.(selection)
	}

	let world: WorldApi | null = null
	/** the overlay outlives any one island, so a new world opens as you left it */
	let zonesVisible = false

	function setWorld(seed: number): void {
		if (world) {
			scene.remove(world.group)
			world.dispose()
		}
		const t0 = performance.now()
		const map = generateMap(seed)
		const t1 = performance.now()
		world = buildWorld(map)
		if (import.meta.env.DEV) {
			console.log(
				`[perf] map ${(t1 - t0) | 0} ms · build ${(performance.now() - t1) | 0} ms · ${map.tiles.length} tiles`
			)
		}
		const box = new THREE.Box3().setFromObject(world.group)
		const center = box.getCenter(new THREE.Vector3())
		world.group.position.x = -center.x
		world.group.position.z = -center.z
		scene.add(world.group)
		world.showZones(zonesVisible)
		selection = []
		showSelection()
	}

	// --- picking: click selects, shift-click adds, shift-drag spans --------
	const raycaster = new THREE.Raycaster()
	const pointer = new THREE.Vector2()
	const projected = new THREE.Vector3()
	let downX = 0
	let downY = 0
	let boxing = false

	/** The hex under a screen point, via the ground it lands on. */
	function tileAtScreen(clientX: number, clientY: number): HexTile | null {
		if (!world) return null
		const rect = canvas.getBoundingClientRect()
		pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
		pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
		raycaster.setFromCamera(pointer, camera)
		for (const hit of raycaster.intersectObjects(world.group.children, true)) {
			const owner = hit.object.userData.tile as HexTile | undefined
			const tile = owner ?? world.tileAt(hit.point)
			if (tile) return tile
		}
		return null
	}

	function onPointerDown(e: PointerEvent): void {
		downX = e.clientX
		downY = e.clientY
		// shift takes the drag away from the camera and gives it to selection
		if (e.shiftKey && e.button === 0) {
			boxing = true
			controls.enabled = false
			marquee.style.display = 'block'
			updateMarquee(e.clientX, e.clientY)
			canvas.setPointerCapture?.(e.pointerId)
		}
	}

	function updateMarquee(x: number, y: number): void {
		const rect = canvas.getBoundingClientRect()
		const left = Math.min(downX, x) - rect.left
		const top = Math.min(downY, y) - rect.top
		marquee.style.left = `${left}px`
		marquee.style.top = `${top}px`
		marquee.style.width = `${Math.abs(x - downX)}px`
		marquee.style.height = `${Math.abs(y - downY)}px`
	}

	function onPointerMove(e: PointerEvent): void {
		if (boxing) updateMarquee(e.clientX, e.clientY)
	}

	/**
	 * Every land hex whose centre falls inside the dragged box.
	 *
	 * Projecting the tiles OUT to the screen beats casting rays back in: one
	 * pass over the map answers any box, at any size, without a ray per pixel.
	 */
	function tilesInBox(x0: number, y0: number, x1: number, y1: number): HexTile[] {
		if (!world) return []
		const rect = canvas.getBoundingClientRect()
		const left = Math.min(x0, x1) - rect.left
		const right = Math.max(x0, x1) - rect.left
		const top = Math.min(y0, y1) - rect.top
		const bottom = Math.max(y0, y1) - rect.top
		const offset = world.group.position
		const found: HexTile[] = []
		for (const tile of world.landTiles()) {
			projected.set(tile.x + offset.x, HEX_HEIGHT, tile.z + offset.z).project(camera)
			if (projected.z > 1) continue // behind the camera
			const sx = ((projected.x + 1) / 2) * rect.width
			const sy = ((1 - projected.y) / 2) * rect.height
			if (sx >= left && sx <= right && sy >= top && sy <= bottom) found.push(tile)
		}
		return found
	}

	function onPointerUp(e: PointerEvent): void {
		const moved = Math.hypot(e.clientX - downX, e.clientY - downY)

		if (boxing) {
			boxing = false
			controls.enabled = true
			marquee.style.display = 'none'
			canvas.releasePointerCapture?.(e.pointerId)
			const span = moved > 6 ? tilesInBox(downX, downY, e.clientX, e.clientY) : []
			if (span.length > 0) {
				// shift-drag ADDS to what is already held
				const held = new Set(selection.map((t) => `${t.q},${t.r}`))
				selection = [...selection, ...span.filter((t) => !held.has(`${t.q},${t.r}`))]
				showSelection()
				return
			}
		}

		if (moved > 6) return // a camera drag, not a click

		const tile = tileAtScreen(e.clientX, e.clientY)
		if (e.shiftKey) {
			// shift-click toggles one hex in or out of the span
			if (tile) {
				const k = `${tile.q},${tile.r}`
				const at = selection.findIndex((t) => `${t.q},${t.r}` === k)
				selection = at >= 0 ? selection.filter((_, i) => i !== at) : [...selection, tile]
			}
		} else {
			selection = tile ? [tile] : []
		}
		showSelection()
	}

	canvas.addEventListener('pointerdown', onPointerDown)
	canvas.addEventListener('pointermove', onPointerMove)
	canvas.addEventListener('pointerup', onPointerUp)

	function resize(): void {
		const w = canvas.clientWidth
		const h = canvas.clientHeight
		if (
			canvas.width !== w * renderer.getPixelRatio() ||
			canvas.height !== h * renderer.getPixelRatio()
		) {
			renderer.setSize(w, h, false)
			camera.aspect = w / h
			camera.updateProjectionMatrix()
		}
	}
	// dev diagnostics handle (harmless in prod; enables live inspection)
	;(window as unknown as Record<string, unknown>).__scene = {
		renderer,
		scene,
		camera,
		controls,
		sea,
		daylight,
		world: () => world
	}

	const clock = new THREE.Clock()
	let raf = 0
	function animate(): void {
		raf = requestAnimationFrame(animate)
		resize()
		rig.update(clock.getDelta())
		// detail follows the eye: blocks of the island rise and fall between
		// full build, distant stand-in and bare ground as you travel
		world?.updateLod(camera.position)
		renderer.render(scene, camera)
	}
	animate()

	return {
		setWorld,
		placeBuilding(tile, kind) {
			world?.placeBuilding(tile, kind)
		},
		removeBuilding(tile) {
			world?.removeBuilding(tile)
		},
		buildingAt(tile) {
			return world?.buildingAt(tile) ?? null
		},
		population() {
			return world?.population() ?? 0
		},
		stats() {
			return world?.stats() ?? EMPTY_STATS
		},
		setZone(tiles, zone) {
			world?.setZone(tiles, zone)
		},
		zoneAt(tile) {
			return world?.zoneAt(tile) ?? 'RESERVE'
		},
		showZones(on) {
			zonesVisible = on
			world?.showZones(on)
		},
		setHour: daylight.setHour,
		dispose(): void {
			cancelAnimationFrame(raf)
			canvas.removeEventListener('pointerdown', onPointerDown)
			canvas.removeEventListener('pointermove', onPointerMove)
			canvas.removeEventListener('pointerup', onPointerUp)
			marquee.remove()
			rig.dispose()
			daylight.dispose()
			if (world) world.dispose()
			disposeObject(scene)
			renderer.dispose()
		}
	}
}
