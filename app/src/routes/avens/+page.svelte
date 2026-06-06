<script lang="ts">
	import { goto } from '$app/navigation'
	import { t } from '$lib/i18n'
	import { AVENS } from './avens-data'
</script>

<svelte:head>
	<title>{t('nav.avens')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
		<header class="space-y-1.5">
			<h1 class="text-2xl font-semibold tracking-tight">{t('nav.avens')}</h1>
			<p class="text-muted-foreground text-sm leading-relaxed">
				{t('avens.subtitle')}
			</p>
		</header>

		<ul class="grid gap-3 sm:grid-cols-2">
			{#each AVENS as aven (aven.id)}
				<li>
					<button
						type="button"
						class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors"
						onclick={() => goto(aven.href)}
					>
						<span
							class="text-base font-medium tracking-tight group-hover:text-accent-foreground"
							>{aven.name}</span
						>
						<span class="text-muted-foreground text-[11px] group-hover:text-accent-foreground/85"
							>{aven.subtitle}</span
						>
					</button>
				</li>
			{/each}
		</ul>
	</div>
</div>
