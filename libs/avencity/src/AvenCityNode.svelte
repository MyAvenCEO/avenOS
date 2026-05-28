<script lang="ts">
	import { T, useTask, useThrelte } from '@threlte/core'
	import { HTML } from '@threlte/extras'
	import AvenCityUpgradeIcon from './AvenCityUpgradeIcon.svelte'
	import AvenCityUpgradePanel from './AvenCityUpgradePanel.svelte'
	import { AVENCITY_UPGRADES, upgradeById } from './upgrades'
	import {
		CIRCLE_GROWTH_SPEED,
		PANEL_POINTER_GAP_PX,
		circleDiameterPx,
		circleIconPx,
		radiusForUpgradeLevel,
		spawnRadiusForLevel
	} from './world-units'
	import { avencityBrand } from './brand-colors'

	const iconFillRatio = 0.75
	const panelArrowPx = 5

	let {
		position = [0, 0, 0] as [number, number, number],
		initialUpgradeId = AVENCITY_UPGRADES[0].id
	}: {
		position?: [number, number, number]
		initialUpgradeId?: string
	} = $props()

	const { camera, size } = useThrelte()

	let hovered = $state(false)
	let panelOpen = $state(false)
	let selectedUpgradeId = $state(initialUpgradeId)
	let circleRadius = $state(spawnRadiusForLevel(upgradeById(initialUpgradeId).level))
	let dotPx = $state(40)
	let iconPx = $state(30)

	const activeUpgrade = $derived(upgradeById(selectedUpgradeId))
	const targetRadius = $derived(radiusForUpgradeLevel(activeUpgrade.level))

	const isMarineStyle = $derived(
		hovered || panelOpen || selectedUpgradeId !== initialUpgradeId
	)

	const fillColor = $derived(isMarineStyle ? avencityBrand.marine : avencityBrand.surfaceSoft)
	const borderColor = $derived(isMarineStyle ? avencityBrand.marine : avencityBrand.border)
	const iconColor = $derived(
		isMarineStyle ? avencityBrand.marineForeground : avencityBrand.navy
	)

	useTask((delta) => {
		const diff = targetRadius - circleRadius
		if (Math.abs(diff) >= 0.0008) {
			circleRadius += diff * Math.min(1, delta * CIRCLE_GROWTH_SPEED)
		} else {
			circleRadius = targetRadius
		}

		const cam = camera.current
		const viewport = size.current
		if (cam && viewport.width > 0 && viewport.height > 0) {
			dotPx = circleDiameterPx(circleRadius, cam, viewport)
			iconPx = circleIconPx(circleRadius, cam, viewport, iconFillRatio)
		}
	})

	function onNodeClick(e: MouseEvent) {
		e.stopPropagation()
		e.stopImmediatePropagation()
		panelOpen = !panelOpen
	}

	function onSelectUpgrade(id: string) {
		selectedUpgradeId = id
	}

	function onNodeEnter(e: MouseEvent) {
		e.stopPropagation()
		hovered = true
	}

	function onNodeLeave(e: MouseEvent) {
		e.stopPropagation()
		hovered = false
	}

	function onNodePointerDown(e: PointerEvent) {
		e.stopPropagation()
		e.stopImmediatePropagation()
	}
</script>

<T.Group {position}>
	<HTML center position={[0, 0, 0.01]} wrapperClass="avencity-node-html">
		<button
			type="button"
			class="avencity-node-hit"
			style:width="{dotPx}px"
			style:height="{dotPx}px"
			style:background={fillColor}
			style:border-color={borderColor}
			style:color={iconColor}
			aria-label="{activeUpgrade.title}, level {activeUpgrade.level}"
			aria-expanded={panelOpen}
			onclick={onNodeClick}
			onmouseenter={onNodeEnter}
			onmouseleave={onNodeLeave}
			onpointerdown={onNodePointerDown}
		>
			<span class="avencity-node-icon" style:width="{iconPx}px" style:height="{iconPx}px">
				<AvenCityUpgradeIcon variant={activeUpgrade.icon} size="100%" />
			</span>
		</button>
	</HTML>

	{#if panelOpen}
		<HTML position={[0, circleRadius, 0.02]} wrapperClass="avencity-panel-html">
			<div
				class="avencity-panel-anchor"
				style:--panel-gap="{PANEL_POINTER_GAP_PX}px"
				style:--panel-arrow="{panelArrowPx}px"
			>
				<AvenCityUpgradePanel
					upgrade={activeUpgrade}
					selectedId={selectedUpgradeId}
					onSelect={onSelectUpgrade}
				/>
			</div>
		</HTML>
	{/if}
</T.Group>

<style>
	:global(.avencity-node-html),
	:global(.avencity-panel-html) {
		pointer-events: none !important;
	}

	.avencity-node-hit {
		display: grid;
		place-items: center;
		box-sizing: border-box;
		margin: 0;
		padding: 0;
		border: 1px solid;
		border-radius: 9999px;
		cursor: pointer;
		pointer-events: auto;
		touch-action: manipulation;
		transition:
			background-color 160ms ease,
			border-color 160ms ease,
			color 160ms ease;
	}

	.avencity-node-icon {
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.avencity-node-icon :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}

	.avencity-panel-anchor {
		transform: translate(-50%, calc(-100% - var(--panel-gap, 6px) - var(--panel-arrow, 5px)));
		pointer-events: none;
	}

	.avencity-panel-anchor :global(.avencity-panel) {
		pointer-events: auto;
	}
</style>
