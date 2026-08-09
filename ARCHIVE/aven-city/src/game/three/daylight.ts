/**
 * The sun, and the day it drags behind it.
 *
 * One dial — the hour, 0..24 — drives everything: where the sun stands, what
 * color it burns, how strong the sky fill is, what color the sky and fog are,
 * and where the visible sun disc hangs. Night is lit by a cold, dim fill so
 * the board stays readable instead of going black.
 *
 * Shared by the world and the sandbox so a time set in one reads the same in
 * the other.
 */
import * as THREE from 'three'

export interface DaylightOptions {
	/** half-width of the sun's shadow frustum in world units */
	shadowExtent?: number
	shadowFar?: number
	shadowMapSize?: number
	/** how far out the sun disc and its orbit sit */
	distance?: number
}

export interface Daylight {
	sun: THREE.DirectionalLight
	/** the color the page background should match at the current hour */
	skyColor: THREE.Color
	setHour(hour: number): void
	dispose(): void
}

/** Key colors of a day, in order: deep night, dawn, noon, dusk, back to night. */
const SKY_STOPS: Array<[number, string]> = [
	[0, '#101a2e'],
	[4.5, '#2b3f5e'],
	[6, '#cfa88f'],
	[7.5, '#cde9ec'],
	[17, '#cde9ec'],
	[19, '#e8b48c'],
	[20.5, '#3d3f63'],
	[22, '#101a2e'],
	[24, '#101a2e']
]

const SUN_STOPS: Array<[number, string]> = [
	[0, '#5f7bb5'],
	[5, '#8e7fa8'],
	[6.5, '#ffb37a'],
	[8.5, '#fff2dd'],
	[16, '#fff2dd'],
	[18.5, '#ffb37a'],
	[20, '#c2739b'],
	[21.5, '#5f7bb5'],
	[24, '#5f7bb5']
]

function gradientAt(stops: Array<[number, string]>, hour: number, out: THREE.Color): THREE.Color {
	const h = ((hour % 24) + 24) % 24
	for (let i = 0; i < stops.length - 1; i++) {
		const [h0, c0] = stops[i]
		const [h1, c1] = stops[i + 1]
		if (h >= h0 && h <= h1) {
			const t = h1 === h0 ? 0 : (h - h0) / (h1 - h0)
			return out.set(c0).lerp(new THREE.Color(c1), t)
		}
	}
	return out.set(stops[stops.length - 1][1])
}

/** Sun elevation: up around 5h, down around 20h, highest at midday. */
function sunElevation(hour: number): number {
	return Math.sin(((hour - 5) / 15) * Math.PI)
}

export function createDaylight(scene: THREE.Scene, options: DaylightOptions = {}): Daylight {
	const extent = options.shadowExtent ?? 90
	const distance = options.distance ?? 120

	const fill = new THREE.HemisphereLight('#eaf6ff', '#d8c9a8', 0.95)
	scene.add(fill)

	const sun = new THREE.DirectionalLight('#fff2dd', 2.1)
	sun.castShadow = true
	sun.shadow.mapSize.set(options.shadowMapSize ?? 2048, options.shadowMapSize ?? 2048)
	sun.shadow.camera.left = -extent
	sun.shadow.camera.right = extent
	sun.shadow.camera.top = extent
	sun.shadow.camera.bottom = -extent
	sun.shadow.camera.far = options.shadowFar ?? 280
	sun.shadow.bias = -0.0004
	scene.add(sun)

	// the visible sun: an unlit disc riding the same arc as the light
	const disc = new THREE.Mesh(
		new THREE.SphereGeometry(distance * 0.045, 16, 12),
		new THREE.MeshBasicMaterial({ color: '#fff6e0', fog: false })
	)
	scene.add(disc)

	const skyColor = new THREE.Color('#cde9ec')
	const sunColor = new THREE.Color('#fff2dd')

	function setHour(hour: number): void {
		const elevation = sunElevation(hour)
		// the sun swings across the sky through the day; the angle also drifts
		// so morning and evening light come from opposite sides
		const azimuth = ((hour - 5) / 15) * Math.PI * 0.9 + 0.35
		const height = Math.max(elevation, -0.35)
		const horizontal = Math.cos(Math.asin(Math.max(-1, Math.min(1, height))))
		sun.position.set(
			Math.cos(azimuth) * horizontal * distance,
			height * distance,
			Math.sin(azimuth) * horizontal * distance
		)
		disc.position.copy(sun.position)

		gradientAt(SKY_STOPS, hour, skyColor)
		gradientAt(SUN_STOPS, hour, sunColor)
		sun.color.copy(sunColor)

		// daylight fades out as the sun sets; a cold fill keeps night readable
		const day = Math.max(0, Math.min(1, elevation * 3.4))
		sun.intensity = 0.12 + day * 2.0
		sun.visible = elevation > -0.12
		disc.visible = elevation > -0.05
		;(disc.material as THREE.MeshBasicMaterial).color
			.copy(sunColor)
			.lerp(new THREE.Color('#ffffff'), 0.35)

		fill.intensity = 0.34 + day * 0.65
		fill.color.copy(skyColor).lerp(new THREE.Color('#eaf6ff'), 0.55)
		fill.groundColor.set('#d8c9a8').lerp(new THREE.Color('#2a3348'), 1 - day)

		scene.background = skyColor
		if (scene.fog) (scene.fog as THREE.Fog).color.copy(skyColor)
	}

	setHour(11)

	return {
		sun,
		skyColor,
		setHour,
		dispose(): void {
			scene.remove(fill, sun, disc)
			disc.geometry.dispose()
			;(disc.material as THREE.Material).dispose()
			fill.dispose()
			sun.dispose()
		}
	}
}
