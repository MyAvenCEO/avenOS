<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core'
	import { Grid, OrbitControls } from '@threlte/extras'
	import { Color, MOUSE } from 'three'
	import AvenCityNode from './AvenCityNode.svelte'
	import AvenCityPlotHex from './AvenCityPlotHex.svelte'
	import { avencityBrand } from './brand-colors'
	import { clientToWorldXY } from './client-to-world'
	import {
		axialToWorld,
		type HexCoord,
		isInsideHex,
		nearestExpansionCandidate,
		occupiedKeySet
	} from './hex-grid'
	import { hexCircumradiusForViewport } from './hex-utils'
	import { addPlotAt, createInitialPlotMap, type Plot } from './plot-map'

	const { scene, camera, size, renderer } = useThrelte()

	const initialScreenFill = 0.8

	let plots = $state<Plot[]>(createInitialPlotMap())
	let hexRadius = $state<number | null>(null)
	let viewportKey = $state('')
	let previewCoord = $state<HexCoord | null>(null)
	let previewHovered = $state(false)
	let hoveredPlotId = $state<string | null>(null)
	let highlightedPlotId = $state<string | null>(null)

	const occupiedKeys = $derived(occupiedKeySet(plots))

	$effect(() => {
		scene.background = new Color(avencityBrand.cream)
		return () => {
			scene.background = null
		}
	})

	useTask(() => {
		const cam = camera.current
		const viewport = size.current
		if (!cam || viewport.width <= 0 || viewport.height <= 0) return

		const nextViewportKey = `${viewport.width}x${viewport.height}`
		if (hexRadius === null || nextViewportKey !== viewportKey) {
			hexRadius = hexCircumradiusForViewport(cam, viewport, initialScreenFill)
			viewportKey = nextViewportKey
		}
	})

	$effect(() => {
		const canvas = renderer.domElement
		if (!canvas || hexRadius === null) return

		function onPointerMove(e: PointerEvent) {
			const target = e.target as Element
			if (target.closest('.avencity-node-hit, .avencity-panel')) return
			if (target.closest('.avencity-plot-hit--preview')) return

			const cam = camera.current
			if (!cam) return

			const { x, y } = clientToWorldXY(e.clientX, e.clientY, canvas, cam)

			for (const plot of plots) {
				if (isInsideHex(x, y, plot.q, plot.r, hexRadius!)) {
					previewCoord = null
					return
				}
			}

			previewCoord = nearestExpansionCandidate(x, y, hexRadius!, occupiedKeys)
		}

		canvas.addEventListener('pointermove', onPointerMove, { passive: true })
		return () => canvas.removeEventListener('pointermove', onPointerMove)
	})

	function plotWorldPosition(plot: Plot): [number, number, number] {
		if (hexRadius === null) return [0, 0, 0.005]
		const { x, y } = axialToWorld(plot.q, plot.r, hexRadius)
		return [x, y, 0.005]
	}

	function plotNodePosition(plot: Plot): [number, number, number] {
		if (hexRadius === null) return [0, 0, 0]
		const { x, y } = axialToWorld(plot.q, plot.r, hexRadius)
		return [x, y, 0]
	}

	function placePreviewPlot() {
		if (!previewCoord) return
		plots = addPlotAt(plots, previewCoord.q, previewCoord.r)
		previewCoord = null
		previewHovered = false
	}
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

	{#if hexRadius !== null}
		{#each plots as plot (plot.id)}
			<AvenCityPlotHex
				position={plotWorldPosition(plot)}
				worldRadius={hexRadius}
				active={hoveredPlotId === plot.id || highlightedPlotId === plot.id}
				onhoverchange={(hovered) => {
					hoveredPlotId = hovered ? plot.id : null
				}}
			/>
			<AvenCityNode
				position={plotNodePosition(plot)}
				initialUpgradeId={plot.upgradeId}
				onhighlightchange={(highlighted) => {
					highlightedPlotId = highlighted ? plot.id : null
				}}
			/>
		{/each}

		{#if previewCoord}
			{@const previewPos = plotWorldPosition({ id: 'preview', q: previewCoord.q, r: previewCoord.r, upgradeId: '' })}
			<AvenCityPlotHex
				position={[previewPos[0], previewPos[1], 0.004]}
				worldRadius={hexRadius}
				preview
				active={previewHovered}
				onhoverchange={(hovered) => {
					previewHovered = hovered
				}}
				onplace={placePreviewPlot}
			/>
		{/if}
	{/if}
</T.Group>
