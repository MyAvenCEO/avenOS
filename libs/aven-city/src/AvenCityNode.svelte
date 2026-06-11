<script lang="ts">
import { T, useTask, useThrelte } from '@threlte/core'
import { HTML } from '@threlte/extras'
import AvenCityUpgradeIcon from './AvenCityUpgradeIcon.svelte'
import AvenCityUpgradePanel from './AvenCityUpgradePanel.svelte'
import { avencityBrand } from './brand-colors'
import { AVENCITY_UPGRADES, upgradeById } from './upgrades'
import {
	CIRCLE_GROWTH_SPEED,
	circleDiameterPx,
	circleIconPx,
	PANEL_POINTER_GAP_PX,
	radiusForUpgradeLevel,
	spawnRadiusForLevel
} from './world-units'

const iconFillRatio = 0.75
const panelArrowPx = 5

let {
	position = [0, 0, 0] as [number, number, number],
	initialUpgradeId = AVENCITY_UPGRADES[0].id,
	onhighlightchange
}: {
	position?: [number, number, number]
	initialUpgradeId?: string
	onhighlightchange?: (highlighted: boolean) => void
} = $props()

const { camera, size } = useThrelte()

let hovered = $state(false)
let panelOpen = $state(false)
let selectedUpgradeId = $state<string | undefined>()
let circleRadius = $state<number | undefined>()

$effect.pre(() => {
	selectedUpgradeId ??= initialUpgradeId
	circleRadius ??= spawnRadiusForLevel(upgradeById(initialUpgradeId).level)
})

const activeUpgrade = $derived(upgradeById(selectedUpgradeId ?? initialUpgradeId))
const targetRadius = $derived(radiusForUpgradeLevel(activeUpgrade.level))

const isMarineStyle = $derived(
	hovered || panelOpen || (selectedUpgradeId ?? initialUpgradeId) !== initialUpgradeId
)

$effect(() => {
	const highlighted = isMarineStyle
	onhighlightchange?.(highlighted)
})

const fillColor = $derived(isMarineStyle ? avencityBrand.marine : avencityBrand.surfaceSoft)
const borderColor = $derived(isMarineStyle ? avencityBrand.marine : avencityBrand.border)
const iconColor = $derived(isMarineStyle ? avencityBrand.marineForeground : avencityBrand.navy)

let dotPx = $state(40)
let iconPx = $state(30)

useTask((delta) => {
	if (circleRadius === undefined) return

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
	if (id === selectedUpgradeId) return
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

function onPanelWheel(e: WheelEvent) {
	e.stopPropagation()
}
</script>

<T.Group {position}>
	<HTML
		center
		position={[0, 0, 0.01]}
		wrapperClass="avencity-node-html"
		zIndexRange={[9_500_000, 9_400_000]}
	>
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
		<HTML
			position={[0, targetRadius, 0.08]}
			wrapperClass="avencity-panel-html"
			zIndexRange={[10_000_000, 9_900_000]}
		>
			<div
				class="avencity-panel-anchor"
				style:--panel-gap="{PANEL_POINTER_GAP_PX}px"
				style:--panel-arrow="{panelArrowPx}px"
				onwheel={onPanelWheel}
			>
				<AvenCityUpgradePanel
					upgrade={activeUpgrade}
					selectedId={selectedUpgradeId ?? initialUpgradeId}
					onSelect={onSelectUpgrade}
				/>
			</div>
		</HTML>
	{/if}
</T.Group>

<style>
:global(.avencity-node-html),
:global(.avencity-panel-html) {
	pointer-events: none;
	z-index: 10000000;
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
