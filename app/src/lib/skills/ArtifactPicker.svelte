<script lang="ts">
import { tick, untrack } from 'svelte'
import { type StudioArtifact, studioName, studioRequest } from './studio.svelte'
import { studioErrorMessage } from './studio-request'

let {
	name,
	type,
	items,
	multiple = false,
	optional = false,
	value,
	onchange
}: {
	name: string
	type?: { key: string; version: number }
	items: StudioArtifact[]
	multiple?: boolean
	optional?: boolean
	value: string | string[] | null | undefined
	onchange: (value: string | string[] | null) => void
} = $props()
let open = $state(false)
let query = $state('')
let loaded = $state<StudioArtifact[]>([])
let selectedItems = $state<StudioArtifact[]>([])
let selectionError = $state('')
let loading = $state(false)
let error = $state('')
let snapshotSequence: number | undefined
let nextAfter = $state<string | null>(null)
let loadedType = ''
const available = $derived([
	...new Map(
		[...items, ...loaded, ...selectedItems]
			.filter((item) => !type || (item.typeKey === type.key && item.typeVersion === type.version))
			.map((item) => [item.artifactId, item])
	).values()
])
async function loadMore(refresh = false) {
	if (!type || loading) return
	const expected = `${type.key}@${type.version}`
	if (refresh || loadedType !== expected) {
		loaded = []
		snapshotSequence = undefined
		nextAfter = null
		loadedType = expected
	}
	loading = true
	error = ''
	try {
		const page = await studioRequest<{
			items: StudioArtifact[]
			snapshotSequence: number
			nextAfter: string | null
		}>('items', {
			typeKey: type.key,
			...(snapshotSequence === undefined ? {} : { snapshotSequence }),
			...(nextAfter ? { after: nextAfter } : {}),
			limit: 64
		})
		if (!type || `${type.key}@${type.version}` !== expected) return
		loaded = [...loaded, ...page.items.filter((item) => item.typeVersion === type.version)]
		snapshotSequence = page.snapshotSequence
		nextAfter = page.nextAfter
	} catch (cause) {
		error = studioErrorMessage(cause)
	} finally {
		loading = false
	}
}
let field: HTMLInputElement | undefined = $state()
let trigger: HTMLButtonElement | undefined = $state()
const ids = $derived(Array.isArray(value) ? value : value ? [value] : [])
$effect(() => {
	const requested = [...ids]
	const expectedType = type
	const known = untrack(() => [...items, ...loaded])
	let cancelled = false
	selectionError = ''
	selectedItems = []
	// A saved binding can be older than the recent sidebar or the first picker
	// page. Resolve exact selections without treating them as an empty input.
	void (async () => {
		const resolved: StudioArtifact[] = []
		try {
			if (requested.length > 256) throw Error('Too many selected items. Refine this collection.')
			for (const id of requested) {
				if (cancelled) return
				const item =
					known.find((candidate) => candidate.artifactId === id) ??
					(await studioRequest<{ artifact: StudioArtifact }>('inspect', { artifactId: id }))
						.artifact
				if (
					item.artifactId !== id ||
					(expectedType &&
						(item.typeKey !== expectedType.key || item.typeVersion !== expectedType.version))
				)
					throw Error('A selected item does not match this input. Choose a replacement.')
				resolved.push(item)
			}
			if (!cancelled) selectedItems = resolved
		} catch (cause) {
			if (!cancelled) selectionError = studioErrorMessage(cause)
		}
	})()
	return () => {
		cancelled = true
	}
})
const matches = $derived(
	available.filter((item) =>
		`${studioName(item)} ${item.artifactId} ${item.payload.from ?? ''}`
			.toLowerCase()
			.includes(query.toLowerCase())
	)
)
const selected = $derived(available.filter((item) => ids.includes(item.artifactId)))
function choose(id: string) {
	if (multiple) onchange(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])
	else {
		onchange(id)
		close()
	}
}
function close() {
	open = false
	void tick().then(() => trigger?.focus())
}
function details(item: StudioArtifact) {
	return [
		item.payload.from,
		item.committedAt ? new Date(item.committedAt).toLocaleString() : '',
		item.artifactId.slice(0, 8)
	]
		.filter(Boolean)
		.join(' · ')
}
</script>

<div class="picker">
	<button
		class="trigger"
		type="button"
		bind:this={trigger}
		aria-label={`Input ${name}`}
		aria-expanded={open}
		onclick={() => { open = !open; if (open) { query = ''; if(snapshotSequence===undefined || loadedType!==`${type?.key}@${type?.version}`) void loadMore(); void tick().then(() => field?.focus()) } }}
	>
		<span
			>{selected.length === 1 && ids.length === 1 ? studioName(selected[0]) : ids.length ? `${ids.length} ${ids.length === 1 ? 'item' : 'items'} selected` : optional ? 'None · optional' : multiple ? 'Choose items…' : 'Choose an item…'}</span
		><span>⌄</span>
	</button>
	{#if selected.length === 1}
		<small class="selected-detail">{details(selected[0])}</small>
	{/if}
	{#if selectionError}
		<small class="selected-detail" role="alert">{selectionError}</small>
	{/if}
	{#if open}
		<div
			class="choices"
			role="dialog"
			tabindex="-1"
			aria-label={`Choose ${name}`}
			onkeydown={event => { if (event.key === 'Escape') { event.stopPropagation(); close() } }}
		>
			<input
				bind:this={field}
				bind:value={query}
				aria-label={`Find ${name}`}
				placeholder="Find by name, sender or reference…"
			>
			<div class="results">
				{#if error}
					<p role="alert">
						{error}<button type="button" onclick={() => void loadMore()}>Try again</button>
					</p>
				{/if}
				{#each matches as item (item.artifactId)}
					<button
						type="button"
						class:chosen={ids.includes(item.artifactId)}
						aria-pressed={ids.includes(item.artifactId)}
						onclick={() => choose(item.artifactId)}
					>
						<span class="mark">{ids.includes(item.artifactId) ? '✓' : multiple ? '□' : '◇'}</span>
						<span><strong>{studioName(item)}</strong><small>{details(item)}</small></span>
					</button>
				{:else}
					<p>
						{loading ? 'Loading matching items…' : available.length ? 'No matches in the loaded items. Try another reference or load more.' : 'No matching items yet. Ask Aven to find or prepare one.'}
					</p>
				{/each}
				{#if nextAfter}
					<button type="button" disabled={loading} onclick={() => void loadMore()}>
						{loading ? 'Loading…' : 'Load more items'}
					</button>
				{/if}
			</div>
			<footer>
				{#if type}
					<button type="button" disabled={loading} onclick={() => void loadMore(true)}>
						{loading ? 'Loading…' : 'Refresh items'}
					</button>
				{/if}
				{#if optional || multiple}
					<button type="button" onclick={() => onchange(multiple ? [] : null)}>
						Clear selection
					</button>
				{/if}
				<button type="button" onclick={close}>
					{multiple ? `Done · ${ids.length} selected` : 'Close'}
				</button>
			</footer>
		</div>
	{/if}
</div>

<style>
.picker {
	min-width: 0;
	width: 100%;
}
button,
input {
	font: inherit;
	color: inherit;
}
button {
	cursor: pointer;
}
.trigger {
	display: flex;
	justify-content: space-between;
	gap: 12px;
	width: 100%;
	padding: 12px;
	text-align: left;
	border: 1px solid var(--color-border);
	border-radius: 12px;
	background: var(--color-surface-raised, #fffdf8);
}
.trigger span:first-child {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
small {
	display: block;
	font-size: 11px;
	color: var(--color-muted-foreground, #63796f);
	overflow-wrap: anywhere;
}
.selected-detail {
	margin: 5px 12px 0;
}
.choices {
	margin-top: 8px;
	border: 1px solid var(--color-border);
	border-radius: 12px;
	overflow: hidden;
	background: var(--color-surface-raised, #fffdf8);
}
input {
	width: 100%;
	padding: 12px;
	border-bottom: 1px solid var(--color-border);
	background: transparent;
}
.results {
	max-height: 230px;
	overflow-y: auto;
}
.results button {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	text-align: left;
	padding: 10px 12px;
}
.results button:hover,
.chosen {
	background: var(--color-surface-selected, #e8ece6);
}
.mark {
	flex: 0 0 20px;
}
strong {
	font-size: 13px;
	overflow-wrap: anywhere;
}
p {
	padding: 16px;
	font-size: 12px;
}
footer {
	display: flex;
	justify-content: flex-end;
	gap: 16px;
	padding: 10px 12px;
	border-top: 1px solid var(--color-border);
	font-size: 12px;
}
button:focus-visible,
input:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: -2px;
}
</style>
