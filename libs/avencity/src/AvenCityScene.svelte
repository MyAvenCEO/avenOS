<script lang="ts">
	import { T, useThrelte } from '@threlte/core'
	import { Grid, OrbitControls } from '@threlte/extras'
	import { Color, MOUSE } from 'three'
	import AvenCityNode from './AvenCityNode.svelte'
	import { avencityBrand } from './brand-colors'

	const { scene } = useThrelte()

	$effect(() => {
		scene.background = new Color(avencityBrand.cream)
		return () => {
			scene.background = null
		}
	})
</script>

<T.OrthographicCamera makeDefault position={[0, 0, 10]} zoom={90} near={0.1} far={100}>
	<OrbitControls
		enableRotate={false}
		enablePan={true}
		enableZoom={true}
		zoomToCursor={true}
		screenSpacePanning={true}
		mouseButtons={{ LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }}
	/>
</T.OrthographicCamera>

<T.Group>
	<Grid
		cellColor="#d8dde4"
		sectionColor="#c5cad3"
		cellSize={0.45}
		sectionSize={2.25}
		fadeDistance={24}
		infiniteGrid
		position={[0, 0, -0.02]}
	/>

	<AvenCityNode position={[0, 0, 0]} />
</T.Group>
