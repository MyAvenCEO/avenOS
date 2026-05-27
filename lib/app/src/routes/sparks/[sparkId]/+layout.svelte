<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import SlideAsideLayout from '$lib/ui/SlideAsideLayout.svelte'

	let { children: pageChildren } = $props()

	let asideOpen = $state(false)

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
	const isGalleryView = $derived(path.includes('/gallery'))

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
		{
			href: `${sparkBase}/gallery`,
			label: 'Gallery',
			match: (p: string) => p.startsWith(`${sparkBase}/gallery`),
		},
	])

	const mainClass = $derived(
		isTalkView
			? 'relative flex min-h-0 min-w-0 flex-col overflow-hidden'
			: 'relative min-h-0 min-w-0 overflow-y-auto',
	)

	const contentClass = $derived(
		isTalkView ? 'flex min-h-0 flex-1 flex-col pb-0 md:pb-0' : 'pb-20 md:pb-0',
	)

	$effect(() => {
		void path
		asideOpen = false
	})

	function closeAsideOnNav() {
		asideOpen = false
	}
</script>

<svelte:head>
	<title>{sparkMeta?.name ?? 'Spark'} · AvenOS</title>
</svelte:head>

<SlideAsideLayout
	bind:open={asideOpen}
	asideLabel="Spark views"
	asideWidthClass="w-[min(85vw,12rem)] max-w-[12rem]"
	desktopGridClass="md:grid-cols-[12rem_minmax(0,1fr)]"
	class="min-h-0 flex-1"
	{mainClass}
	{contentClass}
	children={main}
>
	{#snippet aside()}
		<div class="mb-3 space-y-2 px-2 pt-2">
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
				onclick={closeAsideOnNav}
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
					onclick={closeAsideOnNav}
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	{/snippet}

	{#snippet main()}
		<div
			class="mx-auto flex w-full flex-col px-4 sm:px-6
				{isGalleryView ? 'max-w-5xl' : 'max-w-3xl'}
				{isTalkView ? 'min-h-0 flex-1 py-3 pb-0 sm:py-6' : 'py-6 sm:py-8'}"
		>
			{@render pageChildren()}
		</div>
	{/snippet}
</SlideAsideLayout>
