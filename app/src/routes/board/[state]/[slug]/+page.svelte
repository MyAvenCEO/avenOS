<script lang="ts">
import { findWorkItem, WorkItemDoc } from '@avenos/aven-board'
import { page } from '$app/state'
import { t } from '$lib/i18n'
import { navigateApp } from '$lib/shell'

const item = $derived(findWorkItem(page.params.state ?? '', page.params.slug ?? ''))

function back(e: MouseEvent): void {
	navigateApp('/board', e)
}
</script>

<svelte:head>
	<title>{item ? item.title : t('board.notFound')}{t('common.titleSuffix')}</title>
</svelte:head>

{#if item}
	<WorkItemDoc {item} backHref="/board" backLabel={t('board.backToBoard')} onBack={back} />
{:else}
	<div
		class="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-background px-6 text-center"
	>
		<p class="text-sm text-muted-foreground">{t('board.notFound')}</p>
		<a
			href="/board"
			data-sveltekit-preload-data="hover"
			class="inline-flex items-center gap-2 rounded-full border border-border bg-background/95 px-5 py-2.5 text-xs font-bold tracking-widest uppercase text-foreground transition-colors hover:bg-white/10"
			onclick={back}
		>
			{t('board.backToBoard')}
		</a>
	</div>
{/if}
