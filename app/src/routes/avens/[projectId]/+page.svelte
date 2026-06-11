<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'
import { avenById } from '../avens-data'
import GoalsDashboard from './dashboard/GoalsDashboard.svelte'
import { sparksForAven } from './identities-data'

const projectParam = $derived(String((page.params as { projectId?: string }).projectId ?? ''))
const decodedProjectId = $derived(decodeURIComponent(projectParam))
const avenBase = $derived(`/avens/${encodeURIComponent(decodedProjectId)}`)
const aven = $derived(avenById(decodedProjectId))
const identities = $derived(sparksForAven(decodedProjectId))
</script>

<svelte:head>
	<title>{aven?.name ?? decodedProjectId}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
		<header class="space-y-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold tracking-wide uppercase"
				onclick={() => navigateApp('/avens')}
			>
				{t('nav.allAvens')}
			</button>
			<h1 class="text-2xl font-semibold tracking-tight">{aven?.name ?? decodedProjectId}</h1>
		</header>

		<!-- Aven-level global goal -->
		<GoalsDashboard />

		<!-- Identities scoped under this aven -->
		<section class="space-y-3">
			<div class="space-y-1">
				<h2 class="text-lg font-semibold tracking-tight">{t('nav.identities')}</h2>
				<p class="text-muted-foreground text-sm leading-relaxed">
					{t('avens.sparksSubtitle')}
				</p>
			</div>

			{#if identities.length === 0}
				<p class="text-muted-foreground text-sm">{t('avens.noSparksYet')}</p>
			{:else}
				<ul class="grid gap-3 sm:grid-cols-2">
					{#each identities as identity (identity.id)}
						<li>
							<button
								type="button"
								class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors"
								onclick={() => goto(`${avenBase}/${encodeURIComponent(identity.id)}`)}
							>
								<span
									class="text-[11px] font-semibold tracking-wider uppercase opacity-70 group-hover:text-accent-foreground/90"
									>{identity.kind}</span
								>
								<span
									class="text-base font-medium tracking-tight group-hover:text-accent-foreground"
									>{identity.name}</span
								>
								<span
									class="text-muted-foreground text-[11px] group-hover:text-accent-foreground/85"
									>{identity.subtitle}</span
								>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</div>
</div>
