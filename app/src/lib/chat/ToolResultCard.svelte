<script lang="ts">
import type { ToolPreview } from '@avenos/chat-engine/tool-preview'
import CalculationCard from '../artifacts/CalculationCard.svelte'
import KnowledgeCard from '../artifacts/KnowledgeCard.svelte'
import TaskResultCard from './TaskResultCard.svelte'

let { preview }: { preview: ToolPreview } = $props()
</script>

<div class="tool-result">
	{#if preview.kind === 'calculation'}
		<CalculationCard value={preview.value} compact />
	{:else if preview.kind === 'knowledge'}
		<KnowledgeCard value={preview.value} />
	{:else if preview.kind === 'tasks'}
		<TaskResultCard {preview} />
	{:else}
		<article aria-label="Tool result" class="receipt">
			<strong>{preview.title}</strong>
			<p>{preview.status}</p>
			<details>
				<summary>Details ansehen</summary>
				{#each preview.details as detail}
					<p>{detail}</p>
				{/each}
			</details>
		</article>
	{/if}
</div>

<style>
.tool-result {
	width: 100%;
	max-width: 48rem;
	min-width: 0;
	flex: 0 0 auto;
}
/* Chat owns the shared result column; artifact-library layouts stay independent. */
.tool-result > :global(article) {
	box-sizing: border-box;
	width: 100%;
	max-width: none;
	margin-inline: 0;
}
.receipt {
	border: 1px solid var(--color-border);
	border-radius: 14px;
	padding: 12px 14px;
	background: var(--color-surface-raised);
	font-size: 13px;
	overflow-wrap: anywhere;
	min-width: 0;
}
p {
	margin: 6px 0;
}
details {
	font-size: 11px;
	color: var(--color-muted-foreground);
}
summary {
	cursor: pointer;
}
</style>
