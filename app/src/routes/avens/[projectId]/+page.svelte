<script lang="ts">
import { page } from '$app/state'
import { goto } from '$app/navigation'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'
import { avenById } from '../avens-data'
import { sparksForAven } from './sparks-data'

const projectParam = $derived(String((page.params as { projectId?: string }).projectId ?? ''))
const decodedProjectId = $derived(decodeURIComponent(projectParam))
const avenBase = $derived(`/avens/${encodeURIComponent(decodedProjectId)}`)
const aven = $derived(avenById(decodedProjectId))
const sparks = $derived(sparksForAven(decodedProjectId))
</script>

<svelte:head>
	<title>{aven?.name ?? decodedProjectId}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
		<header class="space-y-2">
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-[10px] font-semibold tracking-wide uppercase"
				onclick={() => navigateApp('/avens')}
			>
				{t('nav.allAvens')}
			</button>
			<h1 class="text-2xl font-semibold tracking-tight">{aven?.name ?? decodedProjectId}</h1>
			<p class="text-muted-foreground text-sm leading-relaxed">
				{t('avens.sparksSubtitle')}
			</p>
		</header>

		{#if sparks.length === 0}
			<p class="text-muted-foreground text-sm">{t('avens.noSparksYet')}</p>
		{:else}
			<ul class="grid gap-3 sm:grid-cols-2">
				{#each sparks as spark (spark.id)}
					<li>
						<button
							type="button"
							class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors"
							onclick={() => goto(`${avenBase}/${encodeURIComponent(spark.id)}`)}
						>
							<span
								class="text-[11px] font-semibold tracking-wider uppercase opacity-70 group-hover:text-accent-foreground/90"
								>{spark.kind}</span
							>
							<span
								class="text-base font-medium tracking-tight group-hover:text-accent-foreground"
								>{spark.name}</span
							>
							<span class="text-muted-foreground text-[11px] group-hover:text-accent-foreground/85"
								>{spark.subtitle}</span
							>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
