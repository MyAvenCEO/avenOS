<script lang="ts">
import type { SourceContext } from '@avenos/chat-engine/source-context'

let { source }: { source?: SourceContext } = $props()
</script>

{#if source}
	<details class="source-context">
		<summary>Mitgegebener Gesprächskontext · {source.messages.length} Ausschnitte</summary>
		<p>
			Beim Absenden aus dem vorherigen Intent übernommen. Kein vollständiger Verlauf oder
			Quellenbeleg.
		</p>
		<div class="excerpts">
			{#each source.messages as message (message.id)}
				<blockquote>
					<small
						>{message.role === 'user' ? 'Du' : 'Aven'}{message.shortened ? ' · gekürzt' : ''}</small
					>
					<p>{message.content}</p>
				</blockquote>
			{/each}
		</div>
	</details>
{/if}

<style>
.source-context {
	margin: 0.4rem 0;
	color: var(--color-quiet);
	font-size: var(--fs-small);
}
summary {
	cursor: pointer;
}
.excerpts {
	max-height: 16rem;
	overflow-y: auto;
	overscroll-behavior: contain;
}
blockquote {
	margin: 0.6rem 0;
	padding: 0.3rem 0.75rem;
	border-left: 2px solid var(--color-border);
}
blockquote p {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	color: var(--color-foreground);
}
</style>
