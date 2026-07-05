<script lang="ts">
// board 0094 — a dotted backdrop that groups the flattened steps belonging to ONE sub-flow, so in the
// Runs trace graph you can see which actors came from which parent (e.g. "Document Ingest", "Map Brain
// (Invoice)"). Non-interactive; sized + positioned by FlowGraph to wrap its children. Renders behind them.
let { data }: { data: { label?: string } } = $props()
</script>

<div
	class="border-border/60 size-full rounded-[var(--radius-lg)] border border-dashed"
	style="background: color-mix(in srgb, var(--color-muted) 18%, transparent)"
>
	{#if data?.label}
		<span
			class="text-muted-foreground absolute top-1.5 left-2.5 text-[10px] font-semibold tracking-wide uppercase"
			>{data.label}</span
		>
	{/if}
</div>
