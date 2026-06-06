<script lang="ts">
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { navigateApp } from '$lib/shell'
	import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
	import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
	let { children: pageOutlet } = $props()

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

	const navSections = $derived(
		asideNavSectionsFromRoutes(
			[
				{
					title: t('nav.viewSection'),
					items: [
						{
							href: `${sparkBase}/talk`,
							label: t('nav.talk'),
							match: (p) => p.startsWith(`${sparkBase}/talk`),
						},
						{
							href: `${sparkBase}/todos`,
							label: t('nav.todos'),
							match: (p) => p.startsWith(`${sparkBase}/todos`),
						},
						{
							href: `${sparkBase}/gallery`,
							label: t('nav.gallery'),
							match: (p) => p.startsWith(`${sparkBase}/gallery`),
						},
						{
							href: `${sparkBase}/members`,
							label: t('nav.members'),
							match: (p) => p.startsWith(`${sparkBase}/members`),
						},
						{
							href: `${sparkBase}/db`,
							label: t('nav.db'),
							match: (p) => p.startsWith(`${sparkBase}/db`),
						},
					],
				},
			],
			path,
		),
	)

	const mainClass = $derived(
		isTalkView
			? 'relative flex min-h-0 min-w-0 flex-col overflow-hidden'
			: 'relative min-h-0 min-w-0 overflow-y-auto',
	)

	const contentClass = $derived(
		isTalkView ? 'flex min-h-0 flex-1 flex-col pb-0 md:pb-0' : 'pb-20 md:pb-0',
	)

	const innerContentClass = $derived(
		[
			'mx-auto flex w-full flex-col px-4 sm:px-6',
			isGalleryView ? 'max-w-5xl' : 'max-w-3xl',
			isTalkView ? 'min-h-0 flex-1 py-3 pb-0 sm:py-6' : 'py-6 sm:py-8',
		].join(' '),
	)
</script>

<svelte:head>
	<title>{sparkMeta?.name ?? t('sparks.sparkLabel')}{t('common.titleSuffix')}</title>
</svelte:head>

<AsidePageLayout
	asideLabel={t('nav.sparkViews')}
	sections={navSections}
	desktopGridClass="md:grid-cols-[12rem_minmax(0,1fr)]"
	sectionLabelClass="px-0 md:px-2"
	{mainClass}
	{contentClass}
	{innerContentClass}
	routeKey={path}
>
	{#snippet header()}
		<div class="mb-3 space-y-2 px-2 pt-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold uppercase tracking-wide"
				onclick={() => navigateApp('/sparks')}
			>
				{t('nav.allSparks')}
			</button>
			<div class="space-y-0.5">
				<h2 class="text-sm font-semibold tracking-tight leading-snug">
					{sparkMeta?.name ?? t('sparks.sparkLabel')}
				</h2>
				{#if sparkMeta}
					<p class="text-muted-foreground break-all font-mono text-[10px] leading-snug">
						spark:{sparkMeta.spark_id}
					</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
