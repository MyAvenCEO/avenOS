<script lang="ts">
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { navigateApp } from '$lib/shell'
	import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
	import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
	let { children: pageOutlet } = $props()

	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const decodedIdentityId = $derived(decodeURIComponent(identityParam))
	const identityBase = $derived(`/identities/${encodeURIComponent(decodedIdentityId)}`)

	const identitiesStore = jazzStore('identities')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const identityMeta = $derived(
		identitiesStore.rows.find((s) => idsMatch(s.owner, decodedIdentityId)),
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
							href: `${identityBase}/talk`,
							label: t('nav.talk'),
							match: (p) => p.startsWith(`${identityBase}/talk`),
						},
						{
							href: `${identityBase}/todos`,
							label: t('nav.todos'),
							match: (p) => p.startsWith(`${identityBase}/todos`),
						},
						{
							href: `${identityBase}/gallery`,
							label: t('nav.gallery'),
							match: (p) => p.startsWith(`${identityBase}/gallery`),
						},
						{
							href: `${identityBase}/members`,
							label: t('nav.members'),
							match: (p) => p.startsWith(`${identityBase}/members`),
						},
						{
							href: `${identityBase}/db`,
							label: t('nav.db'),
							match: (p) => p.startsWith(`${identityBase}/db`),
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
	<title>{identityMeta?.name ?? t('identities.identityLabel')}{t('common.titleSuffix')}</title>
</svelte:head>

<AsidePageLayout
	asideLabel={t('nav.identityViews')}
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
				onclick={() => navigateApp('/identities')}
			>
				{t('nav.allIdentities')}
			</button>
			<div class="space-y-0.5">
				<h2 class="text-sm font-semibold tracking-tight leading-snug">
					{identityMeta?.name ?? t('identities.identityLabel')}
				</h2>
				{#if identityMeta}
					<p class="text-muted-foreground break-all font-mono text-[10px] leading-snug">
						identity:{identityMeta.owner}
					</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
