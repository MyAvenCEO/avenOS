<script lang="ts">
import AvenCitySandbox from './AvenCitySandbox.svelte'
import DayNightSlider from './components/DayNightSlider.svelte'
import DomeRail from './components/DomeRail.svelte'
import Icon, { type IconName } from './components/Icon.svelte'
import ResourceIcon from './components/ResourceIcon.svelte'
import { type HexTile, tileResources } from './game/hexmap'
import {
	BUILDINGS,
	canBuildOnTile,
	EMPTY_STATS,
	FACTORIES,
	HEX_HA,
	HEX_RADIUS_M,
	isFactory,
	type PlacedKind,
	settlementCapacity,
	settlementKinds,
	ZONE_COLORS,
	type Zone
} from './game/three/buildWorld'
import type { SceneApi } from './game/three/scene'
import { timeOfDay } from './game/timeOfDay.svelte'
import './styles/index.css'

/**
 * The standalone repo reached the biome sandbox through its own `/sandbox`
 * route. Inside avenOS the game is a component in one world rather than an
 * app with routes, so the sandbox became a view this component swaps to.
 */
let sandbox = $state(false)

// $state, not a plain `let`: leaving for the sandbox unmounts the canvas and
// coming back binds a NEW element, and the scene has to follow it.
let canvas: HTMLCanvasElement | undefined = $state()
let api: SceneApi | undefined
let seed = $state(Math.floor(Math.random() * 90000) + 10000)
/** every hex currently selected — one from a click, many from a shift-drag */
let selected: HexTile[] = $state([])
/** bumped whenever a building lands, so the rail and the count re-read */
let builds = $state(0)

/** What stands across the island: people, ground and growing land. */
const stats = $derived.by(() => {
	builds
	return api?.stats() ?? EMPTY_STATS
})

const num = (v: number, digits = 1): string =>
	v.toLocaleString(undefined, { maximumFractionDigits: digits })

/**
 * Land at whatever scale still reads: m² for a single structure, hectares
 * for a hex or two, km² once a region is settled. All through the reader's
 * own locale, so the separators match the citizen count beside them.
 */
function area(hectares: number): string {
	if (hectares === 0) return '0 m²'
	if (hectares < 1) return `${num(hectares * 10_000, 0)} m²`
	if (hectares < 10) return `${num(hectares)} ha`
	return `${num(hectares / 100, 2)} km²`
}

/**
 * The zoning law.
 *
 * Three land uses, and they are not interchangeable. RESERVE is land left
 * alone — it feeds nobody, which is what makes it a reserve. WORKS is the
 * dome plus the industrial crop around it: hemp, bamboo, fibre, the
 * feedstock the dome runs on. LIVING is the settlement plus the food forest
 * that feeds exactly the people standing on it — every settlement carries
 * its own, so this share can never be raised by borrowing from the others.
 *
 * At these shares a fully built island reaches Munich's population without
 * Munich's trick of eating off someone else's land.
 */
const ZONING = [
	{ zone: 'RESERVE', icon: 'reserve', label: 'reserve', target: 0.3 },
	{ zone: 'WORKS', icon: 'works', label: 'works', target: 0.25 },
	{ zone: 'LIVING', icon: 'living', label: 'living', target: 0.45 }
] as const satisfies ReadonlyArray<{
	zone: Zone
	icon: IconName
	label: string
	target: number
}>

/** Where each zone stands against its target, as a share of zonable land. */
const zoning = $derived.by(() => {
	builds
	const land = Math.max(1, stats.landHexes)
	const held: Record<Zone, number> = {
		RESERVE: stats.zonedReserve,
		WORKS: stats.zonedWorks,
		LIVING: stats.zonedLiving
	}
	return ZONING.map((z) => {
		const share = held[z.zone] / land
		return {
			...z,
			hexes: held[z.zone],
			share,
			// a zone reads as met once it is within a point of its target,
			// and over only when it has genuinely eaten another's land
			over: share > z.target + 0.01
		}
	})
})

/** Painting zones is a different job from founding on them. */
let zoningMode = $state(false)

$effect(() => {
	// read it FIRST: inside `api?.showZones(zoningMode)` the argument is
	// never evaluated while api is still undefined, so the effect would
	// never take zoningMode as a dependency and never run again
	const on = zoningMode
	api?.showZones(on)
})

/** Designates every selected hex, and leaves the selection to paint on. */
function zone(z: Zone): void {
	if (selected.length === 0) return
	api?.setZone(selected, z)
	builds++
}

/**
 * The readouts across the top: one badge each, not one stack, and ALL of
 * them always.
 *
 * They used to appear only once something stood on the island, which made
 * an untouched world look like it had no land — it has 10 580 hexes of it,
 * every one already reserve, and that is a fact about the world rather
 * than about what you have got round to building.
 */
const readouts = $derived.by(() => [
	{ icon: 'citizens' as IconName, value: stats.citizens.toLocaleString(), label: 'citizens' },
	{ icon: 'settled' as IconName, value: area(stats.settledHa), label: 'settled' },
	{ icon: 'permaculture' as IconName, value: area(stats.permacultureHa), label: 'food land' },
	{ icon: 'crop' as IconName, value: area(stats.cropHa), label: 'crop land' },
	{ icon: 'reserve' as IconName, value: area(stats.reserveHa), label: 'reserve' },
	{
		icon: 'density' as IconName,
		value: `${num(stats.densityPerKm2, 0)} /km²`,
		label: 'density'
	}
])

/** the hexes in the selection that can actually take a building */
const targets = $derived(selected.filter(canBuildOnTile))
const buildable = $derived(targets.length > 0)
/** one hex shows what stands on it; a span shows a level only if they agree */
const standing = $derived.by(() => {
	builds
	if (targets.length === 0) return null
	const first = api?.buildingAt(targets[0]) ?? null
	return targets.every((t) => (api?.buildingAt(t) ?? null) === first) ? first : null
})

/* --- what a hex is, in metres and hectares -------------------------- */
/** a food forest feeds one person off 1 000 m² */
const FOOD_M2 = 1000

const circleHa = (dM: number) => (Math.PI * (dM / 2) ** 2) / 10_000
/** The living cluster's span, in metres, and the ground it covers. */
const CLUSTER_M = 357
const CLUSTER_HA = circleHa(CLUSTER_M)
/** Indoor beds, half the commons floor, at five times open yield. */
const INDOOR_FEEDS = 66
/** How much of the hex radius the settlement covers. */
const CLUSTER_SHARE = 0.48

/**
 * Ground a hex gives up to growing.
 *
 * A LIVING cluster gives up its whole disc: the domes stand on part of
 * it, but the space between them is squares and paths, not farmland. A
 * WORKS hex only gives up what stands — its yard stays growable.
 */
function takenHa(kind: PlacedKind | null): number {
	if (!kind) return 0
	if (isFactory(kind)) return circleHa(FACTORIES[kind].diameterM)
	return CLUSTER_HA
}

/**
 * The real-world facts about whatever is selected. Land splits three ways:
 * what the domes stand on, what is left open to grow on — the gaps between
 * domes are gardens, not pavement — and what grows under glass.
 */
const facts = $derived.by(() => {
	builds
	const rows: Array<[string, string]> = [
		['⌀', `${Math.round(HEX_RADIUS_M * 2)} m across`],
		['land', `${HEX_HA.toFixed(1)} ha`]
	]
	const built = takenHa(standing)
	const open = HEX_HA - built
	if (built > 0) {
		rows.push([
			standing && isFactory(standing) ? 'built' : 'settled',
			standing && isFactory(standing)
				? `${built.toFixed(1)} ha · no growing`
				: `⌀ ${CLUSTER_M} m · ${built.toFixed(1)} ha · ${Math.round((built / HEX_HA) * 100)}% of the land`
		])
	}
	rows.push(['open', `${open.toFixed(1)} ha · feeds ${Math.round((open * 10_000) / FOOD_M2)}`])

	if (!standing) return rows
	if (isFactory(standing)) {
		rows.push(['works', `⌀ ${FACTORIES[standing].diameterM} m`])
		rows.push(['makes', FACTORIES[standing].output])
		return rows
	}
	const housed = settlementCapacity(BUILDINGS[standing].level)
	rows.push(['houses', `${housed} people`])
	rows.push(['indoor', `1.7 ha beds · feeds ${INDOOR_FEEDS} · 20% of diet`])
	const fed = Math.round((open * 10_000) / FOOD_M2) + INDOOR_FEEDS
	const pct = Math.round((fed / housed - 1) * 100)
	rows.push(['feeds', `${fed} · ${pct >= 0 ? '+' : ''}${pct}% surplus`])
	return rows
})

function build(kind: PlacedKind): void {
	if (!buildable) return
	// building a span applies to every hex in it, so one pick can raise a
	// whole region to the same level
	const clearing = standing === kind
	for (const tile of targets) {
		if (clearing) api?.removeBuilding(tile)
		else api?.placeBuilding(tile, kind)
	}
	builds++
}

// Was an onMount in the standalone repo, where the world outlived the page.
// Here the sandbox swaps the canvas out and back, so the scene is bound to
// the element instead: it tears down on the way out and builds on the
// element it comes back to.
$effect(() => {
	const el = canvas
	if (!el) return
	let disposed = false
	void import('./game/three/scene').then(({ createScene }) => {
		if (disposed) return
		api = createScene(el, {
			onSelect(tile) {
				selected = tile
			}
		})
		api.setHour(timeOfDay.hour)
		api.setWorld(seed)
		// the readouts derive off `builds`; without a nudge they would keep
		// reporting the empty island the page started with
		builds++
	})
	return () => {
		disposed = true
		api?.dispose()
		api = undefined
	}
})

function newWorld(): void {
	seed = Math.floor(Math.random() * 90000) + 10000
	api?.setWorld(seed)
	builds++
}
</script>

<!-- The standalone repo set <svelte:head><title> here. Dropped on the port: this
     is a component inside avenOS, and a lib has no business renaming the app
     window — the title would also outlive a switch back to another world. -->

{#if sandbox}
	<AvenCitySandbox onback={() => (sandbox = false)} />
{:else}
	<div class="avencity fixed inset-0">
		<canvas bind:this={canvas} class="block h-full w-full"></canvas>

		<!-- HUD -->
		<div class="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 md:p-7">
			<div class="flex items-start justify-between gap-3">
				<div class="hud-pill">
					<span class="font-semibold">avenCITY</span>
					<span class="hud-label">world {seed}</span>
				</div>
				<!-- the right-hand column: what stands, then what can be built -->
				<div class="flex flex-col items-end gap-3">
					<div class="flex flex-wrap justify-end gap-2">
						{#each readouts as { icon, value, label } (label)}
							<div class="hud-pill">
								<Icon name={icon} class="h-4 w-4 opacity-70" />
								<span class="font-semibold tabular-nums">{value}</span>
								<span class="hud-label">{label}</span>
							</div>
						{/each}
					</div>

					<!--
					The zoning law. The bars are the law and the buttons are how you
					write it: turn zoning on, span-select ground, and press a use.
					Nothing is ever blocked — a bar simply fills, and turns amber
					once a zone has taken land the others were meant to have.
				-->
					{#if stats.landHexes > 0}
						<div class="hud-pill !w-60 !flex-col !items-stretch gap-2 !rounded-3xl !px-4 !py-3">
							<button
								class="hud-label pointer-events-auto flex items-center justify-between"
								onclick={() => (zoningMode = !zoningMode)}
							>
								zoning
								<span class={zoningMode ? 'text-coral' : 'text-ink-soft'}>
									{zoningMode ? 'painting' : 'show'}
								</span>
							</button>
							{#each zoning as z (z.zone)}
								<button
									class="pointer-events-auto flex flex-col gap-1 rounded-xl px-1 py-0.5 text-left transition disabled:cursor-default"
									class:hover:bg-sky={zoningMode && selected.length > 0}
									disabled={!zoningMode || selected.length === 0}
									onclick={() => zone(z.zone)}
								>
									<div class="flex items-center gap-2 font-mono text-[0.6rem] tracking-[0.06em]">
										<Icon name={z.icon} class="h-3.5 w-3.5" style="color: {ZONE_COLORS[z.zone]}" />
										<span class="text-ink-soft flex-1">{z.label}</span>
										<span class="tabular-nums {z.over ? 'text-coral' : 'text-ink'}">
											{Math.round(z.share * 100)}%
										</span>
										<span class="text-ink-soft tabular-nums">/ {Math.round(z.target * 100)}%</span>
									</div>
									<div class="bg-sky h-1 overflow-hidden rounded-full">
										<div
											class="h-full rounded-full transition-[width] duration-300"
											style="width: {Math.min(
											100,
											(z.share / z.target) * 100
										)}%; background: {z.over ? 'var(--color-coral)' : ZONE_COLORS[z.zone]}"
										></div>
									</div>
								</button>
							{/each}
							{#if zoningMode}
								<span class="hud-label text-center">
									{selected.length > 0
									? `${selected.length} hexes — pick a use`
									: 'shift-drag to span'}
								</span>
							{/if}
						</div>
					{/if}

					<DomeRail
						enabled={buildable}
						{standing}
						hint={selected.length === 0 ? 'select a hex' : buildable ? null : 'not on water'}
						onpick={build}
					/>
				</div>
			</div>

			<div class="flex items-end justify-between gap-3">
				<!-- Tile inspector -->
				{#if selected.length > 1}
					<div class="hud-pill !items-start flex-col gap-2 !rounded-3xl !px-5 !py-4">
						<div class="flex items-baseline gap-3">
							<span class="font-semibold">{selected.length} hexes</span>
							<span class="hud-label">
								{targets.length === selected.length
								? 'span selected'
								: `${targets.length} buildable`}
							</span>
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each [...new Set(selected.flatMap(tileResources))] as res}
								<span
									class="flex items-center gap-1.5 rounded-full bg-sky px-2.5 py-1 font-mono text-[0.65rem] tracking-[0.08em] text-ink"
								>
									<ResourceIcon name={res} class="h-3.5 w-3.5" />
									{res}
								</span>
							{/each}
						</div>
					</div>
				{:else if selected.length === 1}
					<div class="hud-pill !items-start flex-col gap-2 !rounded-3xl !px-5 !py-4">
						<div class="flex items-baseline gap-3">
							<span class="font-semibold">Hex {selected[0].q},{selected[0].r}</span>
							<span class="hud-label">{selected[0].biomes.join(' + ')}</span>
						</div>
						<div class="flex flex-col gap-0.5">
							{#each facts as [ name, value ]}
								<div class="flex items-baseline gap-2 font-mono text-[0.62rem] tracking-[0.06em]">
									<span class="w-12 text-ink-soft">{name}</span>
									<span class="text-ink">{value}</span>
								</div>
							{/each}
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each tileResources(selected[0]) as res}
								<span
									class="flex items-center gap-1.5 rounded-full bg-sky px-2.5 py-1 font-mono text-[0.65rem] tracking-[0.08em] text-ink"
								>
									<ResourceIcon name={res} class="h-3.5 w-3.5" />
									{res}
								</span>
							{/each}
						</div>
					</div>
				{:else}
					<span class="hud-pill hud-label">tap a hex · shift-drag to span</span>
				{/if}
				<div class="flex items-center gap-2">
					<button
						class="hud-pill hud-btn pointer-events-auto font-semibold"
						onclick={() => (sandbox = true)}
					>
						biome sandbox
					</button>
					<button class="hud-pill hud-btn pointer-events-auto font-semibold" onclick={newWorld}>
						↻ new world
					</button>
					<DayNightSlider onchange={(h) => api?.setHour(h)} />
				</div>
			</div>
		</div>
	</div>
{/if}
