/**
 * The biome sandbox: one specimen tile on a display pedestal.
 * Used to iterate on per-biome clay styling in isolation — and, later, to
 * preview per-biome upgrade-level styling variants.
 */
import * as THREE from 'three'
import type { BiomeId } from '../hexmap'
import { buildBiomeTile, type PlacedKind } from './buildWorld'
import { createCameraRig } from './cameraRig'
import { createDaylight } from './daylight'

const SKY = '#cde9ec'

export interface SandboxApi {
	show(biome: BiomeId, seed: number, options?: { building?: PlacedKind }): void
	/** Moves the sun to the given hour of the day (0..24). */
	setHour(hour: number): void
	dispose(): void
}

export function createSandbox(canvas: HTMLCanvasElement): SandboxApi {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.shadowMap.enabled = true
	renderer.shadowMap.type = THREE.PCFSoftShadowMap
	renderer.toneMapping = THREE.ACESFilmicToneMapping
	renderer.toneMappingExposure = 1.05

	const scene = new THREE.Scene()
	scene.background = new THREE.Color(SKY)

	const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50)
	camera.position.set(2.1, 1.9, 2.8)

	// the sandbox is a turntable: the specimen stays centered and you look at
	// it from any angle — no walking away from the thing you are styling
	const rig = createCameraRig(camera, canvas, {
		minDistance: 1.2,
		maxDistance: 9,
		target: new THREE.Vector3(0, 0.35, 0),
		freeMove: false,
		floorY: -0.05
	})

	const daylight = createDaylight(scene, {
		shadowExtent: 3,
		shadowFar: 20,
		distance: 8
	})

	// soft display pedestal catching the tile's shadow
	const pedestal = new THREE.Mesh(
		new THREE.CylinderGeometry(2.4, 2.6, 0.18, 48),
		new THREE.MeshStandardMaterial({ color: '#bcdfe3', roughness: 0.95, metalness: 0 })
	)
	pedestal.position.y = -0.1
	pedestal.receiveShadow = true
	scene.add(pedestal)

	let specimen: THREE.Object3D | null = null

	function disposeSpecimen(): void {
		if (!specimen) return
		scene.remove(specimen)
		specimen.traverse((o) => {
			if (o instanceof THREE.Mesh) {
				o.geometry.dispose()
				const mats = Array.isArray(o.material) ? o.material : [o.material]
				for (const m of mats) m.dispose()
			}
		})
		specimen = null
	}

	function show(biome: BiomeId, seed: number, options: { building?: PlacedKind } = {}): void {
		disposeSpecimen()
		specimen = buildBiomeTile(biome, seed, options)
		scene.add(specimen)
	}

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

	const clock = new THREE.Clock()
	let raf = 0
	function animate(): void {
		raf = requestAnimationFrame(animate)
		resize()
		rig.update(clock.getDelta())
		renderer.render(scene, camera)
	}
	animate()

	return {
		show,
		setHour: daylight.setHour,
		dispose(): void {
			cancelAnimationFrame(raf)
			rig.dispose()
			daylight.dispose()
			disposeSpecimen()
			pedestal.geometry.dispose()
			;(pedestal.material as THREE.Material).dispose()
			renderer.dispose()
		}
	}
}
