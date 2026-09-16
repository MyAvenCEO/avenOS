<script lang="ts">
import type { StudioCatalogEntry, StudioCatalogPage } from '@avenos/actors'
import { studioRequest } from './studio.svelte'

let {
	open = $bindable(false),
	contextKey,
	onchoose
}: {
	open: boolean
	contextKey: string
	onchoose?: (entry: StudioCatalogEntry) => void
} = $props()
let dialog: HTMLDialogElement | undefined = $state()
let currentKey = ''
let search = $state('')
let showBlocked = $state(false)
let entries = $state<StudioCatalogEntry[]>([])
let page = $state<StudioCatalogPage | null>(null)
let loading = $state(false)
let error = $state('')
let sequence = 0
let lastQuery = ''
const visible = $derived(entries)
const actors = $derived(page?.actors ?? [])
const readyCount = $derived(page?.readyVisibleCount ?? '—')

function cue(entry: StudioCatalogEntry): string {
	if (entry.readiness === 'ready') return 'Ready to compose'
	if (entry.reasonCodes.includes('PARAMETERS_SCHEMA_UNSUPPORTED'))
		return 'Needs a guided input form'
	if (entry.reasonCodes.includes('INSTALLATION_UNAVAILABLE'))
		return 'Execution contract not installed yet'
	if (entry.readiness === 'needs-input') return 'Choose an input artifact'
	if (entry.readiness === 'needs-review') return 'Review required before use'
	if (entry.readiness === 'needs-connection') return 'Connect the required account'
	if (entry.readiness === 'host-unavailable') return 'No available host right now'
	return 'Not ready for this Studio runtime'
}
function modeIcon(entry: StudioCatalogEntry): string {
	return entry.mode === 'observe'
		? '◐'
		: entry.mode === 'effect'
			? '↗'
			: entry.mode === 'stream'
				? '≈'
				: entry.mode === 'view'
					? '◈'
					: '◇'
}
async function load(needle: string, reset: boolean) {
	if (!reset && (!page?.nextCursor || loading)) return
	const attempt = ++sequence
	const expectedKey = contextKey
	const previous = page
	loading = true
	error = ''
	try {
		const result = await studioRequest<StudioCatalogPage>('catalog', {
			search: needle.trim(),
			readyOnly: !showBlocked,
			limit: 50,
			...(reset ? {} : { cursor: previous!.nextCursor, viewToken: previous!.viewToken })
		})
		if (attempt !== sequence || expectedKey !== contextKey || !open) return
		entries = reset ? result.entries : [...entries, ...result.entries]
		page = result
	} catch {
		if (attempt === sequence && expectedKey === contextKey)
			error = 'The operations list changed. Refresh to see what is available now.'
	} finally {
		if (attempt === sequence) loading = false
	}
}
$effect(() => {
	if (currentKey === contextKey) return
	currentKey = contextKey
	sequence++
	entries = []
	page = null
	search = ''
	lastQuery = ''
	error = ''
	open = false
})
$effect(() => {
	if (open && dialog && !dialog.open) dialog.showModal()
	else if (!open && dialog?.open) dialog.close()
})
$effect(() => {
	const active = open
	const needle = search
	const blocked = showBlocked
	const key = contextKey
	if (!active || !key) return
	const query = `${blocked ? 'all' : 'ready'}\0${needle.trim()}`
	if (query !== lastQuery) {
		lastQuery = query
		sequence++
		entries = []
		page = null
		loading = false
		error = ''
	}
	const timer = setTimeout(() => void load(needle, true), 250)
	return () => clearTimeout(timer)
})
</script>

<dialog
	bind:this={dialog}
	class="operations"
	aria-label="Studio operations"
	onclose={() => open = false}
>
	<header>
		<div class="title">
			<span class="mark" aria-hidden="true">◈</span>
			<div>
				<span class="eyebrow">Explore / Compose</span>
				<h2>All operations</h2>
			</div>
		</div>
		<button class="close" aria-label="Close operations" onclick={() => open = false}>✕</button>
	</header>
	<p class="intro">
		See what installed Actors can do, and what each one needs before it can be used.
	</p>
	<label class="search"
		><span aria-hidden="true">⌕</span>
		<input
			bind:value={search}
			placeholder="Find an operation"
			aria-label="Find an operation"
		></label
	>
	<div class="filters" aria-label="Operation availability">
		<button class:chosen={!showBlocked} onclick={() => showBlocked = false}>
			Ready <small>{readyCount}</small>
		</button>
		<button class:chosen={showBlocked} onclick={() => showBlocked = true}>
			All permitted <small>{page?.totalVisibleCount ?? '—'}</small>
		</button>
	</div>
	<div class="results" role="region" aria-label="Operations list">
		{#if actors.length}
			<details class="actor-map" open={showBlocked}>
				<summary>
					<span><b>Actor mesh</b><small>{actors.length} visible</small></span>
					<span aria-hidden="true">⌄</span>
				</summary>
				<div class="actor-grid">
					{#each actors as actor (actor.actorId)}
						<div class:flow={actor.kind === 'event-flow'} class="actor" title={actor.description}>
							<span aria-hidden="true">{actor.kind === 'event-flow' ? '≈' : '◇'}</span>
							<div>
								<b>{actor.label}</b
								><small
									>{actor.kind === 'event-flow' ? 'event flow' :
								`${actor.visibleOperationCount} operation${actor.visibleOperationCount === 1 ? '' : 's'}`}</small
								>
							</div>
						</div>
					{/each}
				</div>
			</details>
		{/if}
		{#if error}
			<div class="empty" role="alert">
				<span aria-hidden="true">↻</span>
				<p>{error}</p>
				<button onclick={() => void load(search, true)}>Refresh operations</button>
			</div>
		{:else if loading && !entries.length}
			<p class="loading" role="status">Checking installed operations…</p>
		{:else if !visible.length}
			<div class="empty">
				<span aria-hidden="true">◇</span>
				<p>
					{showBlocked ? 'No permitted operation matches this search.' : 'Nothing is ready to compose yet.'}
				</p>
				<button onclick={() => showBlocked = true}>See all permitted operations →</button>
			</div>
		{:else}
			{#each visible as entry (entry.capabilityId)}
				<article class="operation">
					<div class="operation-head">
						<span class="icon" aria-hidden="true">{modeIcon(entry)}</span>
						<div>
							<h3>{entry.label}</h3>
							<small>{entry.mode === 'unspecified' ? 'Behavior not declared' : entry.mode}</small>
						</div>
						<span class:ready={entry.readiness === 'ready'} class="state">
							{entry.readiness === 'ready' ? '✓ Ready' : '◌ Needs work'}</span
						>
					</div>
					<p class="description">{entry.description}</p>
					<div class="port-route" aria-label="Named inputs and outputs">
						<span
							>{entry.inputs.length ? entry.inputs.map((port) => port.name).join(' + ') : 'No artifact input'}</span
						>
						<b aria-hidden="true">→</b>
						<span
							>{entry.outputs.length ? entry.outputs.map((port) => port.name).join(' + ') : 'No domain output'}</span
						>
					</div>
					<div class="cue">
						<span aria-hidden="true">{entry.readiness === 'ready' ? '✓' : '◌'}</span>{cue(entry)}
					</div>
					{#if entry.canAuthor}
						<button class="compose" onclick={() => onchoose?.(entry)}>Add to Skill ＋</button>
					{/if}
					<details>
						<summary>Contract details</summary>
						<div class="details">
							<p>
								Inputs:
								{entry.inputs.map((port) => `${port.name} · ${port.cardinality}`).join(', ') || 'none'}
							</p>
							<p>
								Outputs:
								{entry.outputs.map((port) => `${port.name} · ${port.cardinality}`).join(', ') || 'none'}
							</p>
							<p>Placement: {entry.placements.join(' or ') || 'not available'}</p>
						</div>
					</details>
				</article>
			{/each}
		{/if}
		{#if page?.nextCursor && !error}
			<button class="more" disabled={loading} onclick={() => void load(search, false)}>
				{loading ? 'Loading…' : 'Show more operations ↓'}
			</button>
		{/if}
	</div>
	<footer>
		<span>Only permitted contracts appear here. Viewing never runs an Actor.</span>
		<button onclick={() => open = false}>Done</button>
	</footer>
</dialog>

<style>
.operations {
	--ink: var(--color-foreground, #243b34);
	--paper: var(--color-surface-raised, #fffdf8);
	--green: var(--color-primary, #326552);
	--line: color-mix(in srgb, var(--ink) 12%, transparent);
	position: fixed;
	inset: 0 0 0 auto;
	margin: 0;
	width: min(620px, 100vw);
	height: 100dvh;
	max-width: none;
	max-height: none;
	padding: 0;
	border: 0;
	border-left: 1px solid var(--line);
	background: var(--paper);
	color: var(--ink);
	box-shadow: -18px 0 60px #172a221c;
	display: flex;
	flex-direction: column;
	font-size: 13px;
}
.operations:not([open]) {
	display: none;
}
.operations::backdrop {
	background: #182c2252;
}
.operations button,
.operations input {
	font: inherit;
}
.operations button {
	cursor: pointer;
}
.operations button:focus-visible,
.operations input:focus-visible,
.operations summary:focus-visible {
	outline: 2px solid var(--green);
	outline-offset: 3px;
}
header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 27px 30px 14px;
	gap: 16px;
}
.title {
	display: flex;
	align-items: center;
	gap: 13px;
}
.mark {
	display: grid;
	place-items: center;
	width: 43px;
	height: 43px;
	border-radius: 14px;
	background: color-mix(in srgb, var(--green) 12%, var(--paper));
	color: var(--green);
	font-size: 25px;
}
.eyebrow {
	color: var(--green);
	font-size: 10px;
	letter-spacing: 1.4px;
	text-transform: uppercase;
}
h2 {
	margin: 2px 0 0;
	font-size: 25px;
	font-weight: 590;
	letter-spacing: -0.9px;
}
.close {
	border: 0;
	background: transparent;
	color: var(--ink);
	border-radius: 8px;
	padding: 7px 10px;
}
.intro {
	margin: 0;
	padding: 0 30px 20px;
	color: color-mix(in srgb, var(--ink) 65%, transparent);
	line-height: 1.5;
}
.search {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0 30px 17px;
	padding: 9px 13px;
	border: 1px solid var(--line);
	border-radius: 11px;
}
.search span {
	color: var(--green);
	font-size: 20px;
}
.search input {
	flex: 1;
	min-width: 0;
	border: 0;
	outline: 0;
	background: transparent;
	color: var(--ink);
}
.filters {
	display: flex;
	gap: 7px;
	padding: 0 30px 18px;
	border-bottom: 1px solid var(--line);
}
.filters button {
	padding: 8px 13px;
	border: 0;
	border-radius: 9px;
	background: transparent;
	color: color-mix(in srgb, var(--ink) 58%, transparent);
}
.filters button.chosen {
	background: color-mix(in srgb, var(--green) 12%, var(--paper));
	color: var(--ink);
}
.filters small {
	margin-left: 5px;
	font-size: 10px;
}
.results {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	padding: 22px 30px 28px;
}
.actor-map {
	margin: 0 0 16px;
	border: 1px solid var(--line);
	border-radius: 15px;
	background: color-mix(in srgb, var(--green) 3%, var(--paper));
}
.actor-map > summary {
	display: flex;
	align-items: center;
	justify-content: space-between;
	list-style: none;
	cursor: pointer;
	padding: 13px 16px;
}
.actor-map > summary::-webkit-details-marker {
	display: none;
}
.actor-map > summary > span:first-child {
	display: flex;
	align-items: baseline;
	gap: 8px;
}
.actor-map > summary b {
	font-size: 12px;
}
.actor-map > summary small {
	color: color-mix(in srgb, var(--ink) 55%, transparent);
}
.actor-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 7px;
	padding: 0 12px 12px;
}
.actor {
	display: flex;
	align-items: center;
	gap: 9px;
	min-width: 0;
	border: 1px solid var(--line);
	border-radius: 10px;
	padding: 9px;
	background: var(--paper);
}
.actor > span {
	color: var(--green);
	font-size: 16px;
}
.actor > div {
	min-width: 0;
}
.actor b,
.actor small {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.actor b {
	font-size: 11px;
	font-weight: 610;
}
.actor small {
	margin-top: 2px;
	font-size: 9px;
	color: color-mix(in srgb, var(--ink) 52%, transparent);
}
.actor.flow {
	border-style: dashed;
}
.operation {
	border: 1px solid var(--line);
	border-radius: 15px;
	padding: 17px 18px;
	margin-bottom: 11px;
	background: color-mix(in srgb, var(--green) 2%, var(--paper));
}
.operation-head {
	display: flex;
	align-items: center;
	gap: 11px;
}
.icon {
	display: grid;
	place-items: center;
	flex: none;
	width: 35px;
	height: 35px;
	border-radius: 10px;
	background: color-mix(in srgb, var(--green) 10%, var(--paper));
	color: var(--green);
	font-size: 21px;
}
.operation-head > div {
	flex: 1;
	min-width: 0;
}
h3 {
	margin: 0;
	font-size: 14px;
	font-weight: 610;
}
.operation-head small {
	display: block;
	margin-top: 2px;
	text-transform: capitalize;
	color: color-mix(in srgb, var(--ink) 55%, transparent);
}
.state {
	white-space: nowrap;
	color: color-mix(in srgb, var(--ink) 65%, transparent);
	font-size: 10px;
	border-radius: 20px;
	border: 1px solid var(--line);
	padding: 5px 8px;
}
.state.ready {
	border-color: color-mix(in srgb, var(--green) 30%, transparent);
	color: var(--green);
}
.description {
	margin: 11px 0 0;
	line-height: 1.5;
	color: color-mix(in srgb, var(--ink) 68%, transparent);
}
.port-route {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
	margin-top: 14px;
	font-size: 11px;
}
.port-route span {
	border: 1px solid var(--line);
	border-radius: 7px;
	padding: 5px 8px;
}
.port-route b {
	color: var(--green);
}
.cue {
	display: flex;
	gap: 7px;
	align-items: center;
	margin-top: 14px;
	color: var(--green);
	font-size: 11px;
}
.compose {
	margin-top: 10px;
	border: 0;
	border-radius: 9px;
	background: var(--green);
	color: white;
	padding: 8px 12px;
}
.operation details {
	margin-top: 12px;
}
.operation summary {
	cursor: pointer;
	color: color-mix(in srgb, var(--ink) 64%, transparent);
	font-size: 11px;
}
.details {
	padding: 7px 0 0 13px;
	color: color-mix(in srgb, var(--ink) 64%, transparent);
}
.details p {
	margin: 6px 0;
}
.empty {
	display: grid;
	justify-items: start;
	gap: 13px;
	padding: 27px 18px;
	border: 1px dashed var(--line);
	border-radius: 15px;
	color: color-mix(in srgb, var(--ink) 65%, transparent);
}
.empty span {
	color: var(--green);
	font-size: 28px;
}
.empty p {
	margin: 0;
}
.empty button,
.more,
footer button {
	border: 1px solid var(--line);
	border-radius: 9px;
	background: transparent;
	padding: 8px 12px;
	color: var(--ink);
}
.loading {
	color: color-mix(in srgb, var(--ink) 60%, transparent);
}
.more {
	width: 100%;
	margin-top: 6px;
}
footer {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 16px;
	border-top: 1px solid var(--line);
	padding: 15px 30px;
	color: color-mix(in srgb, var(--ink) 58%, transparent);
	font-size: 11px;
}
@media (max-width: 620px) {
	header {
		padding: 20px 18px 12px;
	}
	.intro {
		padding: 0 18px 15px;
	}
	.search {
		margin: 0 18px 13px;
	}
	.filters {
		padding: 0 18px 13px;
	}
	.results {
		padding: 17px 18px;
	}
	.actor-grid {
		grid-template-columns: 1fr;
	}
	footer {
		padding: 12px 18px;
	}
}
</style>
