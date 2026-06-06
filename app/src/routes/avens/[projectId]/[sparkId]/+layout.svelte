<script lang="ts">
import { page } from '$app/state'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'
import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
import { avenById } from '../../avens-data'
import { avenSparkById } from '../sparks-data'

let { children: pageOutlet } = $props()

const projectParam = $derived(String((page.params as { projectId?: string }).projectId ?? ''))
const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
const decodedProjectId = $derived(decodeURIComponent(projectParam))
const decodedSparkId = $derived(decodeURIComponent(sparkParam))
const avenBase = $derived(`/avens/${encodeURIComponent(decodedProjectId)}`)
const sparkBase = $derived(`${avenBase}/${encodeURIComponent(decodedSparkId)}`)
const aven = $derived(avenById(decodedProjectId))
const spark = $derived(avenSparkById(decodedProjectId, decodedSparkId))

const path = $derived(page.url.pathname)

const navSections = $derived(
	asideNavSectionsFromRoutes(
		[
			{
				title: t('nav.viewSection'),
				items: [
					{
						href: `${sparkBase}/banking`,
						label: t('nav.banking'),
						match: (p) => p.startsWith(`${sparkBase}/banking`)
					},
					{
						href: `${sparkBase}/orders`,
						label: t('nav.orders'),
						match: (p) => p.startsWith(`${sparkBase}/orders`)
					},
					{
						href: `${sparkBase}/table`,
						label: t('nav.orderTable'),
						match: (p) => p.startsWith(`${sparkBase}/table`)
					},
					{
						href: `${sparkBase}/turnover`,
						label: t('nav.turnover'),
						match: (p) => p.startsWith(`${sparkBase}/turnover`)
					},
					{
						href: `${sparkBase}/products`,
						label: t('nav.products'),
						match: (p) => p.startsWith(`${sparkBase}/products`)
					},
					{
						href: `${sparkBase}/ingest`,
						label: t('nav.ingest'),
						match: (p) => p.startsWith(`${sparkBase}/ingest`)
					}
				]
			}
		],
		path
	)
)
</script>

<svelte:head>
	<title>{spark?.name ?? aven?.name ?? t('nav.avens')}{t('common.titleSuffix')}</title>
</svelte:head>

<AsidePageLayout
	asideLabel={t('nav.avenViews')}
	sections={navSections}
	desktopGridClass="md:grid-cols-[12rem_minmax(0,1fr)]"
	sectionLabelClass="px-0 md:px-2"
	mainClass="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
	contentClass="flex min-h-0 flex-1 flex-col"
	innerContentClass="flex min-h-0 min-w-0 w-full flex-1 flex-col px-4 pt-4 pb-4 sm:px-6 md:px-8"
	routeKey={path}
>
	{#snippet header()}
		<div class="mb-3 space-y-2 px-2 pt-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold tracking-wide uppercase"
				onclick={() => navigateApp(avenBase)}
			>
				{t('nav.backToSparks', { aven: aven?.name ?? decodedProjectId })}
			</button>
			<div class="space-y-0.5">
				<h2 class="text-sm font-semibold leading-snug tracking-tight">
					{spark?.name ?? decodedSparkId}
				</h2>
				{#if spark}
					<p class="text-muted-foreground text-[10px] leading-snug">{spark.subtitle}</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
