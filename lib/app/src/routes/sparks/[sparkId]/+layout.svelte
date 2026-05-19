<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { jazzStore } from '$lib/jazz/store.svelte'

	let { children } = $props()

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const decodedSparkId = $derived(decodeURIComponent(sparkParam))
	const sparkBase = $derived(`/sparks/${encodeURIComponent(decodedSparkId)}`)

	const sparksStore = jazzStore('sparks')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const sparkMeta = $derived(
		sparksStore.rows.find((s) => idsMatch(s.spark_id, decodedSparkId)),
	)

	const path = $derived(page.url.pathname)
	const isTalkView = $derived(path.includes('/talk'))

	const viewTabs = $derived([
		{
			href: `${sparkBase}/talk`,
			label: 'Talk',
			match: (p: string) => p.startsWith(`${sparkBase}/talk`),
		},
		{
			href: `${sparkBase}/todos`,
			label: 'Todos',
			match: (p: string) => p.startsWith(`${sparkBase}/todos`),
		},
	])
</script>

<svelte:head>
	<title>{sparkMeta?.name ?? 'Spark'} · AvenOS</title>
</svelte:head>

<div class="grid h-full min-h-0 w-full grid-cols-[12rem_1fr]">
	<aside
		class="flex min-h-0 flex-col border-r border-border/60 bg-card/20 px-3 pt-3 pb-6"
		aria-label="Spark views"
	>
		<div class="mb-3 space-y-2 px-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold uppercase tracking-wide"
				onclick={() => goto('/sparks')}
			>
				← All sparks
			</button>
			<div class="space-y-0.5">
				<h2 class="text-sm font-semibold tracking-tight leading-snug">
					{sparkMeta?.name ?? 'Spark'}
				</h2>
				{#if sparkMeta}
					<p class="text-muted-foreground break-all font-mono text-[10px] leading-snug">
						spark:{sparkMeta.spark_id}
					</p>
				{/if}
			</div>
			<a
				href="/self/workspaces?spark={encodeURIComponent(decodedSparkId)}"
				class="text-primary hover:underline text-[10px] font-semibold uppercase tracking-wide"
			>
				Share
			</a>
		</div>

		<nav class="flex flex-col gap-0.5">
			<p class="text-muted-foreground mb-1 px-2 text-[9px] font-bold tracking-[0.2em] uppercase">View</p>
			{#each viewTabs as tab (tab.href)}
				{@const active = tab.match(path)}
				<a
					href={tab.href}
					data-sveltekit-preload-data="hover"
					class="rounded-md px-3 py-1.5 text-[13px] transition-colors
						{active
						? 'bg-accent/15 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'}"
					aria-current={active ? 'page' : undefined}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</aside>

	<main
		class="flex min-h-0 flex-col {isTalkView ? 'overflow-hidden' : 'overflow-y-auto'}"
	>
		<div
			class="mx-auto flex w-full max-w-3xl flex-col px-4 sm:px-6
				{isTalkView ? 'min-h-0 flex-1 py-4 sm:py-6' : 'py-6 sm:py-8'}"
		>
			{@render children()}
		</div>
	</main>
</div>
