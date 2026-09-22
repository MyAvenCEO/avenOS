<script lang="ts">
import CopyMessage from './CopyMessage.svelte'
import type { Turn } from './chat.svelte'
import ResponseFeedback from './ResponseFeedback.svelte'

let { turn, intentId }: { turn: Turn; intentId: string } = $props()
</script>

<div data-message-id={turn.id}>
	{#if turn.role === 'assistant'}
		<ResponseFeedback {turn} {intentId}>
			<CopyMessage text={turn.content} />
		</ResponseFeedback>
	{:else}
		<div class="user-actions"><CopyMessage text={turn.content} /></div>
	{/if}
</div>

<style>
.user-actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 0.25rem;
	margin: 0.35rem 0 0.65rem;
	color: var(--color-foreground);
}
</style>
