<!--
	The dome rail: every level a hex can be built up to, with the capacity it
	houses. Shared by the world (founding on the selected hex) and the biome
	sandbox (previewing a level on the specimen), so the two always offer the
	same set in the same order.
-->
<script lang="ts">
import {
	BUILD_ORDER,
	BUILDINGS,
	type BuildingKind,
	FACTORIES,
	FACTORY_KINDS,
	isFactory,
	type PlacedKind,
	settlementCapacity
} from '../game/three/buildWorld'

let {
	enabled = true,
	standing = null,
	hint = null,
	onpick
}: {
	enabled?: boolean
	/** what already stands here, so it can read as placed */
	standing?: PlacedKind | null
	/** why the rail is disabled, shown on the cards */
	hint?: string | null
	onpick: (kind: PlacedKind) => void
} = $props()

/** A hex carries a settlement OR a works, so the rail has two tracks. */
let tab: 'domes' | 'works' = $state('domes')
// follow whatever is standing, so the rail opens on the right track
$effect(() => {
	if (standing) tab = isFactory(standing) ? 'works' : 'domes'
})

const LEVELS = BUILD_ORDER
const standingLevel = $derived(
	standing && !isFactory(standing) ? BUILDINGS[standing as BuildingKind].level : 0
)

/** How many inhabited terraces each level's model carries, so the icon
 * matches the building rather than counting levels. */
const TERRACES: Record<number, number> = { 2: 0, 3: 1, 4: 1, 5: 2 }
</script>

<!-- 44vh, not 62: the rail shares a column with the readout strip, and whatever
     it takes comes straight off the bottom row. At 62vh a selected hex had ~200px
     left for the zoning card AND the inspector. It scrolls either way. -->
<div
	class="hud-pill pointer-events-auto max-h-[44vh] !flex-col !items-stretch gap-1.5 overflow-y-auto !rounded-2xl !px-2.5 !py-2"
>
	<span class="hud-label text-center">
		{#if !enabled}
			{hint ?? 'build'}
		{:else if standing && isFactory(standing)}
			{FACTORIES[standing].output}
		{:else if standingLevel > 0}
			{settlementCapacity(standingLevel)}
			people
		{:else}
			build
		{/if}
	</span>

	<div class="tabs">
		<button class:on={tab === 'domes'} onclick={() => (tab = 'domes')}>domes</button>
		<button class:on={tab === 'works'} onclick={() => (tab = 'works')}>works</button>
	</div>
	{#if tab === 'works'}
		{#each FACTORY_KINDS as kind}
			{@const spec = FACTORIES[kind]}
			<button
				class="dome-card"
				aria-pressed={standing === kind}
				disabled={!enabled}
				title={enabled ? spec.label : (hint ?? spec.label)}
				onclick={() => onpick(kind)}
			>
				<svg viewBox="0 0 72 52" class="h-8 w-12" aria-hidden="true">
					<ellipse cx="36" cy="45" rx="31" ry="2.5" fill="#cfc8ba" />
					<!-- one storey of stone under one wide shell -->
					<path d="M6 45V34h60v11Z" fill="#b9b2a4" />
					<g fill="#5b5347">
						<path
							d="M11 45v-6a3 3 0 0 1 6 0v6ZM24 45v-6a3 3 0 0 1 6 0v6ZM42 45v-6a3 3 0 0 1 6 0v6ZM55 45v-6a3 3 0 0 1 6 0v6Z"
						/>
					</g>
					<rect x="32" y="36" width="8" height="9" fill="#3f3a33" />
					<rect x="5" y="31" width="62" height="3" fill="#cfc8ba" />
					<path d="M8 31a28 17 0 0 1 56 0Z" fill="#26344a" />
					<g stroke="#8d949c" stroke-width="1.3" fill="none" stroke-linejoin="round">
						<path d="M8 31a28 17 0 0 1 56 0" />
						<path d="M36 14v17M14 23h44M22 31 36 14 50 31" />
					</g>
					<rect x="32" y="11" width="8" height="3.5" rx="1" fill="#8d949c" />
					<g fill="#22304a" stroke="#8d949c" stroke-width="0.8">
						<path d="M2 48l9-3 2 3-9 3Z" />
						<path d="M61 48l9-3 2 3-9 3Z" />
					</g>
				</svg>
				<span class="dome-name">{spec.label}</span>
				<span class="dome-cap">{spec.output}</span>
			</button>
		{/each}
	{:else}
		{#each LEVELS as kind}
			{@const spec = BUILDINGS[kind]}
			<button
				class="dome-card"
				aria-pressed={standingLevel >= spec.level}
				disabled={!enabled}
				title={enabled ? spec.label : (hint ?? spec.label)}
				onclick={() => onpick(kind)}
			>
				<svg viewBox="0 0 72 52" class="h-8 w-12" aria-hidden="true">
					{#if spec.level === 1}
						<!-- the tent -->
						<ellipse cx="36" cy="45" rx="24" ry="3" fill="#cfc8ba" />
						<path d="M13 45a23 18 0 0 1 46 0Z" fill="#6d8c5a" />
						<path d="M13 45h46v-6a23 18 0 0 0-46 0Z" fill="#ddd6c4" />
						<g stroke="#3f4a44" stroke-width="1.3" fill="none">
							<path d="M13 45a23 18 0 0 1 46 0M36 27v18M22 32l14 13 14-13" />
						</g>
						<path d="M31 45v-8a5 5 0 0 1 10 0v8Z" fill="#3a3833" />
					{:else}
						<!-- terraces drawn = terraces the model actually has -->
						{@const floors = TERRACES[spec.level] ?? 0}
						{@const baseW = 26 + spec.level * 4}
						{@const floorH = 7}
						{@const baseY = 45}
						{@const arcadeY = baseY - 10}
						{@const topY = arcadeY - floors * floorH}
						{@const domeW = baseW - 6 - floors * 3}
						{@const domeH = 9 + spec.level}
						<!-- ground: the stone arcade -->
						<ellipse cx="36" cy={baseY + 1} rx={baseW / 2 + 3} ry="2.5" fill="#cfc8ba" />
						<path d={`M${36 - baseW / 2} ${baseY}v-10h${baseW}v10Z`} fill="#b9b2a4" />
						<g fill="#5b5347">
							{#each Array(Math.max(3, Math.round(baseW / 9))) as _, i}
								{@const step = baseW / Math.max(3, Math.round(baseW / 9))}
								<path
									d={`M${36 - baseW / 2 + step * i + step * 0.22} ${baseY}v-5a${step * 0.28} ${step * 0.28} 0 0 1 ${step * 0.56} 0v5Z`}
								/>
							{/each}
						</g>
						<!-- the stack of terraces, each stepping in -->
						{#each Array(floors) as _, i}
							{@const w = baseW - 4 - i * 6}
							{@const y = arcadeY - i * floorH}
							<rect x={36 - w / 2 - 1} y={y - 1.5} width={w + 2} height="2.5" fill="#cfc8ba" />
							<rect
								x={36 - w / 2}
								y={y - floorH + 1}
								width={w}
								height={floorH - 2.5}
								fill="#e6ddc8"
							/>
							<g fill="#a9743f">
								{#each Array(Math.max(2, Math.round(w / 11))) as _, j}
									{@const step = w / Math.max(2, Math.round(w / 11))}
									<rect
										x={36 - w / 2 + step * j + step * 0.25}
										y={y - floorH + 2.5}
										width={step * 0.5}
										height={floorH - 4.5}
									/>
								{/each}
							</g>
						{/each}
						<!-- the glass cap, seated on the topmost terrace -->
						<path
							d={`M${36 - domeW / 2} ${topY}a${domeW / 2} ${domeH} 0 0 1 ${domeW} 0Z`}
							fill="#a9dcec"
						/>
						<g stroke="#c08a52" stroke-width="1.3" fill="none" stroke-linejoin="round">
							<path d={`M${36 - domeW / 2} ${topY}a${domeW / 2} ${domeH} 0 0 1 ${domeW} 0`} />
							<path d={`M36 ${topY - domeH}v${domeH}`} />
							<path
								d={`M36 ${topY - domeH}L${36 - domeW / 2 + 2} ${topY}M36 ${topY - domeH}L${36 + domeW / 2 - 2} ${topY}`}
							/>
							<path d={`M${36 - domeW / 2 + 3} ${topY - domeH * 0.5}h${domeW - 6}`} />
						</g>
						<path d={`M33 ${topY - domeH}h6l-3-4Z`} fill="#a9743f" />
					{/if}
				</svg>
				<span class="dome-name">{spec.label}</span>
				<span class="dome-cap">{spec.count}× · {spec.capacity} people</span>
				<span class="dome-note">⌀ {spec.diameterM} m</span>
			</button>
		{/each}
	{/if}
</div>

<style>
.tabs {
	display: flex;
	gap: 0.2rem;
	border-radius: 999px;
	background: color-mix(in srgb, var(--color-sky) 20%, transparent);
	border: 1px solid color-mix(in srgb, white 35%, transparent);
	padding: 0.15rem;
}
.tabs button {
	flex: 1;
	border-radius: 999px;
	padding: 0.22rem 0.3rem;
	font-family: var(--font-mono, monospace);
	font-size: 0.55rem;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	opacity: 0.6;
	cursor: pointer;
}
.tabs button.on {
	background: color-mix(in srgb, var(--color-cloud, #fff) 65%, transparent);
	box-shadow: 0 1px 3px rgb(58 74 80 / 0.12);
	font-weight: 600;
	opacity: 1;
}
.dome-card {
	display: flex;
	width: 6.6rem;
	flex-direction: column;
	align-items: center;
	gap: 0.1rem;
	border-radius: 1rem;
	background: color-mix(in srgb, var(--color-sky) 22%, transparent);
	border: 1px solid color-mix(in srgb, white 45%, transparent);
	box-shadow: inset 0 1px 0 color-mix(in srgb, white 60%, transparent);
	padding: 0.4rem 0.4rem 0.5rem;
	transition:
		transform 0.15s ease,
		box-shadow 0.15s ease;
}
.dome-card:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
.dome-card:not(:disabled):hover {
	transform: translateY(-2px);
	box-shadow: 0 6px 16px rgb(0 0 0 / 0.12);
}
.dome-card[aria-pressed="true"] {
	outline: 2px solid color-mix(in srgb, var(--color-ink) 35%, transparent);
}
.dome-name {
	font-weight: 600;
	font-size: 0.76rem;
}
.dome-cap {
	font-size: 0.58rem;
	opacity: 0.8;
}
.dome-note {
	font-family: var(--font-mono, monospace);
	font-size: 0.52rem;
	letter-spacing: 0.06em;
	opacity: 0.55;
}
</style>
