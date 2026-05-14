<script lang="ts">
	let {
		title = null as string | null,
		rows = [] as Array<{ label: string; value: string | null }>,
		prose = null as string | null
	} = $props()
</script>

<div class="focus-panel space-y-2">
	{#if title}
		<div class="text-xs font-semibold uppercase tracking-[0.12em] opacity-55">{title}</div>
	{/if}
	{#if prose}
		<div class="focus-kv-value whitespace-pre-wrap">{prose}</div>
	{/if}
	{#each rows.filter((row) => row.value) as row (`${row.label}:${row.value}`)}
		<div class="focus-kv">
			<div class="focus-kv-label">{row.label}</div>
			<div class="focus-kv-value whitespace-pre-wrap">{row.value}</div>
		</div>
	{/each}
</div>