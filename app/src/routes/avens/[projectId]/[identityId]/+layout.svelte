<script lang="ts">
import { page } from '$app/state'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'
import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
import { avenById } from '../../avens-data'
import { avenSparkById } from '../identities-data'

let { children: pageOutlet } = $props()

const projectParam = $derived(String((page.params as { projectId?: string }).projectId ?? ''))
const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
const decodedProjectId = $derived(decodeURIComponent(projectParam))
const decodedIdentityId = $derived(decodeURIComponent(identityParam))
const avenBase = $derived(`/avens/${encodeURIComponent(decodedProjectId)}`)
const identityBase = $derived(`${avenBase}/${encodeURIComponent(decodedIdentityId)}`)
const aven = $derived(avenById(decodedProjectId))
const identity = $derived(avenSparkById(decodedProjectId, decodedIdentityId))

const path = $derived(page.url.pathname)

const navSections = $derived(
	asideNavSectionsFromRoutes(
		[
			{
				title: t('nav.viewSection'),
				items: [
					{
						href: `${identityBase}/banking`,
						label: t('nav.banking'),
						match: (p) => p.startsWith(`${identityBase}/banking`)
					},
					{
						href: `${identityBase}/orders`,
						label: t('nav.orders'),
						match: (p) => p.startsWith(`${identityBase}/orders`)
					},
					{
						href: `${identityBase}/table`,
						label: t('nav.orderTable'),
						match: (p) => p.startsWith(`${identityBase}/table`)
					},
					{
						href: `${identityBase}/turnover`,
						label: t('nav.turnover'),
						match: (p) => p.startsWith(`${identityBase}/turnover`)
					},
					{
						href: `${identityBase}/products`,
						label: t('nav.products'),
						match: (p) => p.startsWith(`${identityBase}/products`)
					},
					{
						href: `${identityBase}/ingest`,
						label: t('nav.ingest'),
						match: (p) => p.startsWith(`${identityBase}/ingest`)
					}
				]
			}
		],
		path
	)
)
</script>

<svelte:head>
	<title>{identity?.name ?? aven?.name ?? t('nav.avens')}{t('common.titleSuffix')}</title>
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
					{identity?.name ?? decodedIdentityId}
				</h2>
				{#if identity}
					<p class="text-muted-foreground text-[10px] leading-snug">{identity.subtitle}</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
