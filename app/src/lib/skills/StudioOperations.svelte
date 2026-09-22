<script lang="ts">
import type { StudioCatalogEntry, StudioCatalogPage } from '@avenos/actors'
import { screenContext } from '$lib/chat/screen-context.svelte'
import { studioRequest } from './studio.svelte'
import { studioCatalogTree } from './studio-tree'

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
let addableOnly = $state(false)
let entries = $state<StudioCatalogEntry[]>([])
let page = $state<StudioCatalogPage | null>(null)
let loading = $state(false)
let error = $state('')
let expandedCategories = $state<Record<string, boolean>>({})
let expandedActors = $state<Record<string, boolean>>({})
let sequence = 0
const groups = $derived(studioCatalogTree(page?.actors ?? [], entries, search, addableOnly))
const addableCount = $derived(entries.filter((entry) => entry.canAuthor).length)
const searching = $derived(!!search.trim())
$effect(() => {
	// Closed catalog instances must not clear another visible catalog's context.
	if (!open) return
	screenContext.overlay = {
		kind: 'operation-catalog',
		search,
		addableOnly,
		expandedActors: $state.snapshot(expandedActors)
	}
	return () => {
		screenContext.overlay = null
	}
})

function cue(entry: StudioCatalogEntry): string {
	if (entry.readiness === 'ready') return 'Ready to add'
	if (entry.reasonCodes.includes('PARAMETERS_SCHEMA_UNSUPPORTED'))
		return 'A guided settings form is not available yet.'
	if (entry.reasonCodes.includes('INSTALLATION_UNAVAILABLE'))
		return 'This tool is visible, but its Studio integration is not available yet.'
	if (entry.readiness === 'needs-input') return 'Add this action, then choose its input.'
	if (entry.readiness === 'needs-review') return 'A review is required before this can run.'
	if (entry.readiness === 'needs-connection') return 'Connect the required account before running.'
	if (entry.readiness === 'needs-assurance') return 'Identity verification is required before use.'
	if (entry.readiness === 'host-unavailable')
		return 'Its execution device or service is unavailable.'
	return 'This action cannot run in Studio yet.'
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
async function load() {
	const attempt = ++sequence
	const expectedKey = contextKey
	loading = true
	error = ''
	try {
		let result = await studioRequest<StudioCatalogPage>('catalog', {
			readyOnly: false,
			limit: 100
		})
		const collected = [...result.entries]
		while (result.nextCursor) {
			if (attempt !== sequence || expectedKey !== contextKey || !open) return
			if (collected.length >= 1000) throw new Error('CATALOG_TOO_LARGE')
			result = await studioRequest<StudioCatalogPage>('catalog', {
				readyOnly: false,
				limit: 100,
				cursor: result.nextCursor,
				viewToken: result.viewToken
			})
			collected.push(...result.entries)
		}
		if (attempt !== sequence || expectedKey !== contextKey || !open) return
		entries = collected
		page = result
	} catch {
		if (attempt === sequence && expectedKey === contextKey)
			error = 'Actions could not be loaded. Your current work is still here.'
	} finally {
		if (attempt === sequence) loading = false
	}
}
$effect(() => {
	if (currentKey === contextKey) return
	const changedWorkspace = !!currentKey
	currentKey = contextKey
	sequence++
	entries = []
	page = null
	search = ''
	addableOnly = false
	expandedCategories = {}
	expandedActors = {}
	error = ''
	if (changedWorkspace) open = false
})
$effect(() => {
	if (open && dialog && !dialog.open) dialog.show()
	else if (!open && dialog?.open) dialog.close()
})
$effect(() => {
	if (!open || !contextKey) return
	void load()
	return () => {
		sequence++
	}
})
</script>

<dialog
	bind:this={dialog}
	class="operations"
	aria-label="Studio operations"
	onclose={() => open = false}
	onkeydown={event => { if (event.key === 'Escape') open = false }}
>
	<header>
		<div class="title">
			<span class="mark" aria-hidden="true">◈</span>
			<div>
				<span class="eyebrow">Add to your procedure</span>
				<h2>Find an action</h2>
			</div>
		</div>
		<button class="close" aria-label="Close operations" onclick={() => open = false}>✕</button>
	</header>
	<p class="intro">Browse by task, or search for what you want to do.</p>
	<label class="search"
		><span aria-hidden="true">⌕</span>
		<input
			bind:value={search}
			placeholder="Search actions, tools, or categories"
			aria-label="Find an operation"
		></label
	>
	<div class="filters" aria-label="Operation availability">
		<button
			class:chosen={!addableOnly}
			aria-pressed={!addableOnly}
			onclick={() => addableOnly = false}
		>
			All actions <small>{page ? entries.length : '—'}</small>
		</button>
		<button
			class:chosen={addableOnly}
			aria-pressed={addableOnly}
			onclick={() => addableOnly = true}
		>
			Can add to Skill <small>{page ? addableCount : '—'}</small>
		</button>
	</div>
	<div class="results" role="region" aria-label="Operations list" aria-busy={loading}>
		{#if !contextKey}
			<div class="empty">
				<p>
					Your workspace is still loading. Close this drawer and refresh Studio if it does not
					become available.
				</p>
			</div>
		{:else if error}
			<div class="empty" role="alert">
				<p>{error}</p>
				<button onclick={() => void load()}>Try again</button>
			</div>
		{:else if loading}
			<p class="loading" role="status">Finding your actions…</p>
		{:else if !groups.length}
			<div class="empty">
				<p>
					{searching ? 'No actions match this search.' : addableOnly ? 'No actions can be added to a Skill yet.' : 'No tools are available in this workspace.'}
				</p>
				{#if searching}
					<button onclick={() => search = ''}>Clear search</button>
				{/if}
				{#if addableOnly}
					<button onclick={() => addableOnly = false}>Browse all actions</button>
				{/if}
				{#if !searching && !addableOnly}
					<button onclick={() => void load()}>Refresh actions</button>
				{/if}
			</div>
		{:else}
			<div class="browse-heading">
				<span>{searching ? 'Search results' : 'Browse by category'}</span>
				<small>{groups.reduce((count, group) => count + group.children.length, 0)} tools</small>
			</div>
			{#each groups as group (group.id)}
				<details
					class="category"
					data-category={group.id}
					open={searching || expandedCategories[group.id] === true}
					ontoggle={(event) => { if (!searching) expandedCategories[group.id] = event.currentTarget.open }}
				>
					<summary>
						<span class="category-icon" aria-hidden="true">{group.icon}</span>
						<span class="branch-label"
							><strong>{group.label}</strong><small>{group.hint}</small></span
						>
						<span class="count"
							>{group.actionCount ? `${group.actionCount} action${group.actionCount === 1 ? '' : 's'}` : 'Sessions'}</span
						>
						<span class="chevron" aria-hidden="true">›</span>
					</summary>
					<div class="category-children">
						{#each group.children as branch (branch.actor.actorId)}
							<details
								class="actor-branch"
								open={searching || expandedActors[branch.actor.actorId] === true}
								ontoggle={(event) => { if (!searching) expandedActors[branch.actor.actorId] = event.currentTarget.open }}
							>
								<summary>
									<span
										class="availability"
										class:addable={branch.entries.some((entry) => entry.canAuthor)}
										aria-hidden="true"
									></span>
									<span class="branch-label"
										><strong>{branch.actor.label}</strong>
										<small
											>{branch.actor.kind === 'event-flow' ? 'Live session' : `${branch.entries.length} action${branch.entries.length === 1 ? '' : 's'}`}</small
										>
									</span>
									{#if branch.entries.some((entry) => entry.canAuthor)}
										<span class="available-label">Can add</span>
									{/if}
									<span class="chevron" aria-hidden="true">›</span>
								</summary>
								<div class="actor-content">
									{#each branch.entries as entry (entry.capabilityId)}
										<article class="operation">
											<div class="operation-head">
												<span class="icon" aria-hidden="true">{modeIcon(entry)}</span>
												<div>
													<h3>{entry.label}</h3>
													<small
														>{entry.mode === 'unspecified' ? 'Behavior not declared' : entry.mode}</small
													>
												</div>
												<span class:ready={entry.canAuthor} class="state">
													{entry.canAuthor ? 'Can add' : 'Unavailable'}</span
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
												<span aria-hidden="true">{entry.readiness === 'ready' ? '✓' : '◌'}</span>
												{cue(entry)}
											</div>
											{#if entry.canAuthor}
												<button class="compose" onclick={() => onchoose?.(entry)}>
													Add to Skill ＋
												</button>
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
									{:else}
										<p class="session-description">{branch.actor.description}</p>
										<p class="session-note">
											This tool participates in a live session. Studio session controls are not
											available yet.
										</p>
									{/each}
								</div>
							</details>
						{/each}
					</div>
				</details>
			{/each}
		{/if}
	</div>
	<footer>
		<span>Browsing does not run anything.</span>
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
	z-index: 40;
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
.browse-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 12px;
	color: color-mix(in srgb, var(--ink) 72%, var(--paper));
	font-size: 12px;
}
.category {
	margin-bottom: 10px;
	border: 1px solid var(--line);
	border-radius: 14px;
	overflow: clip;
}
.category > summary,
.actor-branch > summary {
	display: flex;
	align-items: center;
	gap: 12px;
	cursor: pointer;
	list-style: none;
	padding: 15px;
	min-height: 62px;
}
.category > summary:hover,
.actor-branch > summary:hover {
	background: color-mix(in srgb, var(--green) 5%, var(--paper));
}
.category > summary::-webkit-details-marker,
.actor-branch > summary::-webkit-details-marker {
	display: none;
}
.category-icon {
	width: 35px;
	height: 35px;
	display: grid;
	place-items: center;
	flex: none;
	font-size: 21px;
	border-radius: 10px;
	color: var(--green);
	background: color-mix(in srgb, var(--green) 8%, var(--paper));
}
.branch-label {
	flex: 1;
	min-width: 0;
}
.branch-label strong {
	display: block;
	font-size: 13px;
	font-weight: 600;
	overflow-wrap: anywhere;
}
.branch-label small {
	display: block;
	margin-top: 3px;
	font-size: 11px;
	color: color-mix(in srgb, var(--ink) 70%, var(--paper));
}
.count {
	font-size: 11px;
	color: color-mix(in srgb, var(--ink) 70%, var(--paper));
	white-space: nowrap;
}
.chevron {
	font-size: 22px;
	color: color-mix(in srgb, var(--ink) 65%, var(--paper));
}
details[open] > summary > .chevron {
	transform: rotate(90deg);
}
.category-children {
	margin: 0 14px 12px 31px;
	padding-left: 12px;
	border-left: 1px solid var(--line);
}
.actor-branch > summary {
	padding: 10px 7px;
	min-height: 54px;
}
.actor-branch + .actor-branch {
	border-top: 1px solid var(--line);
}
.availability {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	border: 1px solid color-mix(in srgb, var(--ink) 45%, var(--paper));
	flex: none;
}
.availability.addable {
	background: var(--green);
	border-color: var(--green);
}
.available-label {
	color: var(--green);
	font-size: 11px;
}
.actor-content {
	padding: 4px 0 6px 12px;
}
.session-description,
.session-note {
	margin: 0 0 12px;
	line-height: 1.5;
}
.session-note {
	color: color-mix(in srgb, var(--ink) 70%, var(--paper));
	font-size: 12px;
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
.empty p {
	margin: 0;
}
.empty button,
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
	.category-children {
		margin-left: 17px;
		padding-left: 8px;
	}
	.actor-content {
		padding-left: 0;
	}
	.operation-head {
		flex-wrap: wrap;
	}
	.count {
		display: none;
	}
	footer {
		padding: 12px 18px;
	}
}
</style>
