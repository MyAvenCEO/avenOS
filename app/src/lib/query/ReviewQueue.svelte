<script lang="ts">
import { hitlQueue } from '$lib/actors/hitl.svelte'
import GatePreview from './GatePreview.svelte'

const { intentId, composing = false }: { intentId: string; composing?: boolean } = $props()
const current = $derived(
	hitlQueue.items.filter(
		(item) => item.scope !== 'workspace' && (!item.context || item.context === intentId)
	)
)
const workspace = $derived(hitlQueue.items.filter((item) => item.scope === 'workspace'))
const firstCurrentId = $derived(current[0]?.id ?? '')
let section = $state<'current' | 'workspace'>('current')
let expanded = $state(false)
let selectedId = $state('')
const items = $derived(section === 'current' ? current : workspace)
const selected = $derived(items.find((item) => item.id === selectedId) ?? items[0])
const index = $derived(selected ? items.indexOf(selected) : -1)

// A requested, conversation-scoped confirmation gets attention. Background work
// never takes the screen. Dismissing the panel does not decide or discard a gate.
$effect(() => {
	const first = firstCurrentId
	const context = intentId
	void context
	section = 'current'
	selectedId = first ?? ''
	expanded = Boolean(first)
})
$effect(() => {
	if (composing) expanded = false
})

function show(next: 'current' | 'workspace') {
	if (section === next && expanded) expanded = false
	else {
		section = next
		selectedId = ''
		expanded = true
	}
}
function move(offset: number) {
	selectedId = items[(index + offset + items.length) % items.length]?.id ?? ''
}
</script>

{#if current.length || workspace.length}
	<section class="review-queue" aria-label="Pending reviews">
		<div class="review-queue-bar">
			{#if current.length}
				<button
					type="button"
					class="review-queue-toggle"
					data-review-scope="current"
					aria-expanded={expanded && section === 'current'}
					onclick={() => show('current')}
				>
					<span aria-hidden="true">◇</span>
					Review needed <span class="review-count">{current.length}</span>
				</button>
			{/if}
			{#if workspace.length}
				<button
					type="button"
					class="review-queue-toggle"
					data-review-scope="workspace"
					aria-expanded={expanded && section === 'workspace'}
					onclick={() => show('workspace')}
				>
					<span aria-hidden="true">◇</span>
					Workspace reviews <span class="review-count">{workspace.length}</span>
				</button>
			{/if}
			{#if expanded && selected}
				<div class="review-queue-navigation">
					{#if items.length > 1}
						<button
							type="button"
							class="btn btn--ghost"
							aria-label="Previous review"
							onclick={() => move(-1)}
						>
							‹
						</button>
						<span aria-live="polite">{index + 1} / {items.length}</span>
						<button
							type="button"
							class="btn btn--ghost"
							aria-label="Next review"
							onclick={() => move(1)}
						>
							›
						</button>
					{/if}
					<button type="button" class="btn btn--ghost" onclick={() => expanded = false}>
						Later
					</button>
				</div>
			{/if}
		</div>
		{#if expanded && selected}
			{#key selected.id}
				<GatePreview held={selected} bounded />
			{/key}
		{/if}
	</section>
{/if}

<style>
.review-queue {
	flex: 0 0 auto;
	min-width: 0;
}
.review-queue-bar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.4rem;
	padding: 0.25rem 0.5rem;
}
.review-queue-toggle {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 0.65rem;
	border: 1px solid var(--color-border);
	border-radius: 999px;
	font-size: 0.8rem;
	background: var(--color-surface-raised);
}
.review-queue-toggle[aria-expanded="true"] {
	border-color: var(--color-primary);
}
.review-count {
	font-variant-numeric: tabular-nums;
	opacity: 0.65;
}
.review-queue-navigation {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 0.3rem;
	font-size: 0.75rem;
}
</style>
