<script lang="ts">
import { page } from '$app/state'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'
import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'
import { avenById } from '../avens-data'

let { children: pageOutlet } = $props()

const aven = avenById('avenMAIA')
const path = $derived(page.url.pathname)

const navSections = $derived(
	asideNavSectionsFromRoutes(
		[
			{
				title: t('nav.viewSection'),
				items: [
					{
						href: '/avens/avenMAIA/game',
						label: t('nav.maiaCityGame'),
						match: (p) => p.startsWith('/avens/avenMAIA/game')
					}
				]
			}
		],
		path
	)
)
</script>

<svelte:head>
	<title>{aven?.name ?? t('nav.avens')}{t('common.titleSuffix')}</title>
</svelte:head>

<AsidePageLayout
	asideLabel={t('nav.avenViews')}
	sections={navSections}
	desktopGridClass="md:grid-cols-[12rem_minmax(0,1fr)]"
	sectionLabelClass="px-0 md:px-2"
	mainClass="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
	contentClass="flex min-h-0 flex-1 flex-col"
	innerContentClass="flex min-h-0 min-w-0 flex-1 flex-col"
	routeKey={path}
>
	{#snippet header()}
		<div class="mb-3 space-y-2 px-2 pt-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold tracking-wide uppercase"
				onclick={() => navigateApp('/avens')}
			>
				{t('nav.allAvens')}
			</button>
			<div class="space-y-0.5">
				<h2 class="text-sm font-semibold leading-snug tracking-tight">
					{aven?.name ?? 'avenMAIA'}
				</h2>
				{#if aven}
					<p class="text-muted-foreground text-[10px] leading-snug">{aven.subtitle}</p>
				{/if}
			</div>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
