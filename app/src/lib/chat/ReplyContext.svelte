<script lang="ts">
let { inputs }: { inputs?: string[] } = $props()
</script>

{#if inputs && inputs.length > 1}
	<p class="reply-context">Antwort auf {inputs.length} Nachrichten</p>
{/if}

<style>
.reply-context {
	margin: 0.35rem 0;
	color: var(--color-quiet);
	font-size: var(--fs-small);
}
</style>
