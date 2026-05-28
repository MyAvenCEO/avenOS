<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core'
	import { HTML } from '@threlte/extras'
	import { avencityBrand } from './brand-colors'
	import {
		hexCircumradiusForViewport,
		hexPolygonPointsAttr,
		hexVerticalSpanPx,
		hexViewBoxSize
	} from './hex-utils'

	let {
		active = false,
		onhoverchange
	}: {
		active?: boolean
		onhoverchange?: (hovered: boolean) => void
	} = $props()

	const { camera, size } = useThrelte()

	/** Default fill on first render / viewport resize only — not re-applied on zoom. */
	const initialScreenFill = 0.8

	let plotHovered = $state(false)
	let hexRadius = $state<number | null>(null)
	let hexHeightPx = $state(400)
	let hexWidthPx = $state(400)
	let viewportKey = $state('')

	const worldRadius = $derived(hexRadius ?? 1.2)
	const isHighlighted = $derived(active || plotHovered)
	const outlineColor = $derived(isHighlighted ? avencityBrand.marine : avencityBrand.border)
	const polygonPoints = $derived(hexPolygonPointsAttr(worldRadius))
	const viewBox = $derived(hexViewBoxSize(worldRadius))
	const strokeWidth = $derived(worldRadius * 0.004)
	/** Wider invisible edge band so entry from outside the hex still registers. */
	const hitStrokeWidth = $derived(worldRadius * 0.04)
	const dashLength = $derived(worldRadius * 0.028)
	const gapLength = $derived(worldRadius * 0.022)
	const dashPattern = $derived(`${dashLength} ${gapLength}`)

	useTask(() => {
		const cam = camera.current
		const viewport = size.current
		if (!cam || viewport.width <= 0 || viewport.height <= 0) return

		const nextViewportKey = `${viewport.width}x${viewport.height}`
		if (hexRadius === null || nextViewportKey !== viewportKey) {
			hexRadius = hexCircumradiusForViewport(cam, viewport, initialScreenFill)
			viewportKey = nextViewportKey
		}

		const box = hexViewBoxSize(worldRadius)
		hexHeightPx = hexVerticalSpanPx(worldRadius, cam, viewport)
		hexWidthPx = hexHeightPx * (box.width / box.height)
	})

	function onPlotEnter() {
		plotHovered = true
		onhoverchange?.(true)
	}

	function onPlotLeave() {
		plotHovered = false
		onhoverchange?.(false)
	}
</script>

<T.Group>
	<HTML center position={[0, 0, 0.005]} wrapperClass="avencity-plot-html" zIndexRange={[8_000_000, 7_900_000]}>
		<svg
			class="avencity-plot-svg"
			width={hexWidthPx}
			height={hexHeightPx}
			viewBox="{-viewBox.width / 2} {viewBox.minY} {viewBox.width} {viewBox.height}"
		>
			<polygon
				class="avencity-plot-hit"
				role="button"
				aria-label="Grundstück plot"
				tabindex="-1"
				points={polygonPoints}
				fill="transparent"
				stroke="transparent"
				stroke-width={hitStrokeWidth}
				onpointerenter={onPlotEnter}
				onpointerleave={onPlotLeave}
			/>
			<polygon
				class="avencity-plot-outline"
				points={polygonPoints}
				aria-hidden="true"
				fill="none"
				stroke={outlineColor}
				stroke-width={strokeWidth}
				stroke-dasharray={isHighlighted ? undefined : dashPattern}
				stroke-linejoin="round"
			/>
		</svg>
	</HTML>
</T.Group>

<style>
	:global(.avencity-plot-html) {
		pointer-events: none !important;
	}

	.avencity-plot-svg {
		display: block;
		overflow: visible;
		pointer-events: none;
	}

	.avencity-plot-hit {
		/* Hex-shaped hit area: interior + outline, not the SVG bounding box. */
		pointer-events: painted !important;
		cursor: pointer;
	}

	.avencity-plot-outline {
		pointer-events: none;
		transition: stroke 160ms ease;
	}
</style>
