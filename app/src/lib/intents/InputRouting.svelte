<script lang="ts">
import { chatActor } from '$lib/actors/chat.actor.svelte'
import { inputCopy, routingQuestion } from '$lib/chat/input-copy'
import type { PendingInput } from '$lib/chat/input-inbox.svelte'
import type { InputIntent, InputTarget } from '$lib/chat/input-routing'
import { composer } from './composer.svelte'

const input = chatActor.core.input
let choosing = $state('')
let query = $state('')
let matches = $state<InputIntent[]>([])
let searching = $state(false)
let searchError = $state('')
let searchVersion = 0
let newTitle = $state('')
let showPending = $state(false)
const copy = $derived(inputCopy(input.active?.locale ?? 'en-GB'))
const name = (item: PendingInput, id: string) =>
	item.intents.find((i) => i.id === id)?.title ?? 'selected Intent'
const label = (item: PendingInput, target: InputTarget) =>
	target.kind === 'new' ? `New: ${target.title}` : name(item, target.id)
async function edit(item: PendingInput) {
	const text = await input.discard(item.id)
	if (text !== null) composer.focus(`${composer.draft ? '\n' : ''}${text}`)
}
async function search(item: PendingInput) {
	const version = ++searchVersion
	searching = true
	searchError = ''
	try {
		const found = (await chatActor.core.inputCatalog?.(query)) ?? []
		if (version !== searchVersion || choosing !== item.id) return
		matches = found
		input.addCandidates(item.id, found)
	} catch {
		if (version === searchVersion) searchError = copy.unavailable
	} finally {
		if (version === searchVersion) searching = false
	}
}
function openChoices(item: PendingInput) {
	choosing = choosing === item.id ? '' : item.id
	query = ''
	newTitle = item.suggestion?.kind === 'new' ? item.suggestion.title : ''
	matches = item.intents
	searchError = ''
}
</script>

{#if composer.draftError}
	<p class="reason" role="alert">{composer.draftError}</p>
{/if}
{#if input.items.length}
	<div class="routing-tray" aria-label="Messages not sent yet">
		{#if input.items.length > 1}
			<button
				class="pending-count"
				type="button"
				aria-expanded={showPending}
				onclick={() => showPending = !showPending}
			>
				{input.items.length - 1} {copy.pending}
			</button>
			{#if showPending}
				<div class="pending-picker">
					{#each input.items as pending (pending.id)}
						<button
							type="button"
							aria-pressed={pending.id === input.active?.id}
							onclick={() => { input.select(pending.id); showPending = false; choosing = '' }}
						>
							{pending.text}
						</button>
					{/each}
				</div>
			{/if}
		{/if}
		{#each input.active ? [input.active] : [] as item (item.id)}
			<section
				class="pending-input"
				data-input-id={item.id}
				data-stage={item.stage}
				aria-label="Unassigned message"
			>
				<div class="pending-heading">
					<strong>{copy[item.stage]}</strong>
					{#if item.stage !== 'assigning' && !item.assignment}
						<button type="button" onclick={() => edit(item)} aria-label="Edit unassigned message">
							{copy.edit}
						</button>
						<button
							type="button"
							onclick={() => input.discard(item.id)}
							aria-label="Discard unassigned message"
						>
							×
						</button>
					{/if}
				</div>
				<p class="excerpt" title={item.text}>{item.text}</p>
				{#if item.topic}
					<p class="topic">{copy.understood}: {item.topic}</p>
				{/if}
				{#if item.stage === 'failed'}
					<p class="reason" role="alert">{item.error}</p>
					<button type="button" data-route-action="retry" onclick={() => input.retry(item.id)}>
						{copy.retry}
					</button>
				{/if}
				{#if item.stage === 'choice' || (item.stage === 'failed' && !item.assignment)}
					<p class="reason" role="status">{routingQuestion(item)}</p>
					<div class="actions">
						{#if item.suggestion}
							<button
								type="button"
								class="primary"
								data-route-action="suggestion"
								onclick={() => item.suggestion && input.choose(item.id, item.suggestion)}
							>
								{label(item, item.suggestion)}
								→
							</button>
						{/if}
						{#if item.defaultId && item.intents.some(i => i.id === item.defaultId)}
							<button
								type="button"
								data-route-action="keep"
								onclick={() => input.choose(item.id, { kind: 'existing', id: item.defaultId })}
							>
								{copy.keep}
								· {name(item, item.defaultId)}
							</button>
						{/if}
						<button
							type="button"
							data-route-action="choose"
							aria-expanded={choosing === item.id}
							onclick={() => openChoices(item)}
						>
							{copy.choose}
						</button>
					</div>
					{#if choosing === item.id}
						<div class="chooser">
							<div class="search-row">
								<input
									aria-label="Search Intents"
									placeholder={copy.find}
									bind:value={query}
									onkeydown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void search(item) } }}
								>
								<button type="button" onclick={() => search(item)} disabled={searching}>
									{searching ? '…' : copy.search}
								</button>
							</div>
							{#if searchError}
								<p role="alert">{searchError}</p>
							{/if}
							<div class="destinations">
								{#each matches as intent (intent.id)}
									<button
										type="button"
										class="destination"
										data-route-target={intent.id}
										onclick={() => input.choose(item.id, { kind: 'existing', id: intent.id })}
									>
										<strong>{intent.title}</strong
										><span
											>{intent.summary || 'Conversation'}
											{intent.updatedAt ? ` · ${new Date(intent.updatedAt).toLocaleString()}` : ''}
										</span>
									</button>
								{:else}
									<p>{copy.empty}</p>
								{/each}
							</div>
							<div class="search-row">
								<input
									aria-label="New Intent title"
									placeholder={copy.newTitle}
									maxlength="160"
									bind:value={newTitle}
									onkeydown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (newTitle.trim()) input.choose(item.id, { kind: 'new', title: newTitle.trim() }) } }}
								>
								<button
									type="button"
									disabled={!newTitle.trim()}
									data-route-action="new"
									onclick={() => input.choose(item.id, { kind: 'new', title: newTitle.trim() })}
								>
									{copy.send}
								</button>
							</div>
						</div>
					{/if}
				{/if}
			</section>
		{/each}
	</div>
{/if}

<style>
.routing-tray {
	max-height: min(42dvh, 360px);
	overflow: auto;
	padding: 8px 12px;
	border-bottom: 1px solid var(--color-border);
}
.pending-input {
	padding: 8px 0;
	font-size: 13px;
}
.pending-count {
	font-size: 11px;
	margin-bottom: 4px;
}
.pending-picker {
	display: grid;
	gap: 4px;
	max-height: 120px;
	overflow: auto;
}
.pending-picker button {
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}
.topic {
	font-size: 12px;
	margin: 5px 0;
}
.pending-input + .pending-input {
	border-top: 1px solid var(--color-border);
}
.pending-heading {
	display: flex;
	align-items: center;
	gap: 6px;
}
.pending-heading strong {
	flex: 1;
	font-weight: 600;
}
.excerpt {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	margin: 4px 0;
	opacity: 0.75;
}
.reason {
	margin: 6px 0;
	font-size: 12px;
}
.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
button {
	cursor: pointer;
	border: 1px solid var(--color-border);
	border-radius: 12px;
	padding: 6px 10px;
	max-width: 100%;
	overflow-wrap: anywhere;
	text-align: left;
}
button:hover {
	background: var(--color-surface-selected);
}
button:disabled {
	opacity: 0.5;
	cursor: default;
}
.primary {
	background: var(--color-primary);
	color: var(--color-primary-foreground);
}
.primary:hover {
	opacity: 0.9;
	background: var(--color-primary);
}
button:focus-visible,
input:focus-visible {
	outline: 2px solid var(--color-primary);
	outline-offset: 2px;
}
.chooser {
	display: grid;
	gap: 8px;
	margin-top: 10px;
}
.search-row {
	display: flex;
	gap: 6px;
}
input {
	min-width: 0;
	flex: 1;
	border: 1px solid var(--color-border);
	border-radius: 10px;
	padding: 8px;
	background: transparent;
}
.destinations {
	display: grid;
	max-height: 140px;
	overflow: auto;
	gap: 4px;
}
.destination {
	display: grid;
	width: 100%;
}
.destination span {
	font-size: 11px;
	opacity: 0.65;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
</style>
