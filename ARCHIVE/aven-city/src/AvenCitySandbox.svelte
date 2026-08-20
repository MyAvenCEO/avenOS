<script lang="ts">
import { onMount } from 'svelte'
import DayNightSlider from './components/DayNightSlider.svelte'
import DomeRail from './components/DomeRail.svelte'
import ResourceIcon from './components/ResourceIcon.svelte'
import { BIOME_IDS, BIOME_RESOURCES, type BiomeId } from './game/hexmap'
import {
	BUILDINGS,
	buildingForLevel,
	canBuildOn,
	isFactory,
	type PlacedKind
} from './game/three/buildWorld'
import type { SandboxApi } from './game/three/sandboxScene'
import { timeOfDay } from './game/timeOfDay.svelte'

// The standalone repo linked back to `/` from its own route. As a component
// inside avenOS there is no route to return to, so the parent says what
// "back" means.
const { onback }: { onback: () => void } = $props()

let canvas: HTMLCanvasElement
let api: SandboxApi | undefined
let biome: BiomeId = $state('MEADOW')
let seed = $state(Math.floor(Math.random() * 90000) + 10000)
// LV.0 = the natural biome; above it a hex carries either a settlement
// level or a works, so the specimen tracks whatever was picked.
let level = $state(0)
let works: PlacedKind | null = $state(null)
const building = $derived<PlacedKind | null>(works ?? buildingForLevel(level))

onMount(() => {
	let disposed = false
	void import('./game/three/sandboxScene').then(({ createSandbox }) => {
		if (disposed) return
		api = createSandbox(canvas)
		api.setHour(timeOfDay.hour)
		api.show(biome, seed, { building: building ?? undefined })
	})
	return () => {
		disposed = true
		api?.dispose()
	}
})

function pick(b: BiomeId): void {
	biome = b
	// a dome cannot stand on open water, so switching to the lake drops
	// the hex back to its natural state rather than showing an illegal build
	if (!canBuildOn(b)) level = 0
	api?.show(biome, seed, { building: building ?? undefined })
}

function reroll(): void {
	seed = Math.floor(Math.random() * 90000) + 10000
	api?.show(biome, seed, { building: building ?? undefined })
}

function setLevel(lv: number): void {
	if (lv > 0 && !canBuildOn(biome)) return
	works = null
	level = lv
	api?.show(biome, seed, { building: buildingForLevel(lv) ?? undefined })
}
</script>

<!-- <svelte:head><title> dropped on the port into avenOS — see AvenCityGame. -->

<div class="avencity fixed inset-0">
	<canvas bind:this={canvas} class="block h-full w-full"></canvas>

	<div class="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 md:p-7">
		<!-- top bar -->
		<div class="flex items-start justify-between gap-3">
			<div class="hud-pill">
				<span class="font-semibold">avenCITY</span>
				<span class="hud-label">biome sandbox</span>
			</div>
			<button class="hud-pill hud-btn pointer-events-auto font-semibold" onclick={onback}>
				← back to the world
			</button>
		</div>

		<!-- left rail: biome picker -->
		<div
			class="pointer-events-auto absolute top-1/2 left-5 flex max-h-[70vh] -translate-y-1/2 flex-col gap-1.5 overflow-y-auto md:left-7"
		>
			{#each BIOME_IDS as b}
				<button
					class="hud-pill hud-btn !justify-start !gap-2 !py-2 text-[0.8rem] font-semibold
						{b === biome ? '' : 'opacity-60'}"
					onclick={() => pick(b)}
				>
					<ResourceIcon name={BIOME_RESOURCES[b][0]} class="h-4 w-4" />
					<span>{b}</span>
					<span class="hud-label !text-[0.6rem]">{BIOME_RESOURCES[b][0]}</span>
				</button>
			{/each}
		</div>

		<!-- right rail: the same build rail the world uses -->
		<div class="pointer-events-none absolute top-1/2 right-5 -translate-y-1/2 md:right-7">
			<DomeRail
				enabled={canBuildOn(biome)}
				standing={building}
				hint={canBuildOn(biome) ? null : 'not on water'}
				onpick={(kind) => {
					if (isFactory(kind)) {
						works = works === kind ? null : kind;
						level = 0;
						api?.show(biome, seed, { building: works ?? undefined });
					} else {
						setLevel(building === kind ? 0 : BUILDINGS[kind].level);
					}
				}}
			/>
		</div>

		<!-- bottom bar: seed reroll + the shared day/night dial -->
		<div class="flex items-end justify-between gap-3">
			<button class="hud-pill hud-btn pointer-events-auto font-semibold" onclick={reroll}>
				↻ reroll specimen
				<span class="hud-label">{seed}</span>
			</button>
			<DayNightSlider onchange={(h) => api?.setHour(h)} />
		</div>
	</div>
</div>
