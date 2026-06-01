<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core'
	import { HTML } from '@threlte/extras'
	import { avencityBrand } from './brand-colors'
	import { hexPolygonPointsAttr, hexVerticalSpanPx, hexViewBoxSize } from './hex-utils'

	let {
		position = [0, 0, 0.005] as [number, number, number],
		worldRadius,
		active = false,
		preview = false,
		onhoverchange,
		onplace
	}: {
		position?: [number, number, number]
		worldRadius: number
		active?: boolean
		preview?: boolean
		onhoverchange?: (hovered: boolean) => void
		onplace?: () => void
	} = $props()

	const { camera, size } = useThrelte()

	let plotHovered = $state(false)
	let hexHeightPx = $state(400)
	let hexWidthPx = $state(400)

	const isHighlighted = $derived(active || plotHovered)
	const outlineColor = $derived(isHighlighted ? avencityBrand.marine : avencityBrand.border)
	const polygonPoints = $derived(hexPolygonPointsAttr(worldRadius))
	const viewBox = $derived(hexViewBoxSize(worldRadius))
	const strokeWidth = $derived(worldRadius * 0.004)
	const hitStrokeWidth = $derived(worldRadius * 0.04)
	const dashLength = $derived(worldRadius * 0.028)
	const gapLength = $derived(worldRadius * 0.022)
	const dashPattern = $derived(`${dashLength} ${gapLength}`)

	useTask(() => {
		const cam = camera.current
		const viewport = size.current
		if (!cam || viewport.width <= 0 || viewport.height <= 0) return

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

	function onPlotClick(e: MouseEvent) {
		if (!preview) return
		e.stopPropagation()
		e.stopImmediatePropagation()
		onplace?.()
	}

	function onPlotKeydown(e: KeyboardEvent) {
		if (!preview) return
		if (e.key !== 'Enter' && e.key !== ' ') return
		e.preventDefault()
		e.stopPropagation()
		onplace?.()
	}
</script>

<T.Group {position}>
	<HTML center position={[0, 0, 0]} wrapperClass="avencity-plot-html" zIndexRange={[8_000_000, 7_900_000]}>
		<svg
			class="avencity-plot-svg"
			class:avencity-plot-svg--preview={preview}
			width={hexWidthPx}
			height={hexHeightPx}
			viewBox="{-viewBox.width / 2} {viewBox.minY} {viewBox.width} {viewBox.height}"
		>
			{#if preview}
				<polygon
					class="avencity-plot-hit avencity-plot-hit--preview"
					role="button"
					aria-label="Place new Grundstück"
					tabindex="0"
					points={polygonPoints}
					fill="transparent"
					stroke="transparent"
					stroke-width={hitStrokeWidth}
					onpointerenter={onPlotEnter}
					onpointerleave={onPlotLeave}
					onclick={onPlotClick}
					onkeydown={onPlotKeydown}
				/>
			{:else}
				<polygon
					class="avencity-plot-hit"
					role="img"
					aria-label="Grundstück plot"
					points={polygonPoints}
					fill="transparent"
					stroke="transparent"
					stroke-width={hitStrokeWidth}
					onpointerenter={onPlotEnter}
					onpointerleave={onPlotLeave}
				/>
			{/if}
			<polygon
				class="avencity-plot-outline"
				class:avencity-plot-outline--preview={preview}
				points={polygonPoints}
				aria-hidden="true"
				fill="none"
				stroke={outlineColor}
				stroke-width={strokeWidth}
				stroke-dasharray={preview || !isHighlighted ? dashPattern : undefined}
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

	.avencity-plot-svg--preview {
		opacity: 0.92;
	}

	.avencity-plot-hit {
		pointer-events: painted !important;
		cursor: pointer;
	}

	.avencity-plot-hit--preview {
		cursor: copy;
	}

	.avencity-plot-outline {
		pointer-events: none;
		transition: stroke 160ms ease;
	}

	.avencity-plot-outline--preview {
		opacity: 0.88;
	}
</style>
