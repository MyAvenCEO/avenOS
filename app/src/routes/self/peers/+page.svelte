<script lang="ts">
	import { t } from '$lib/i18n'
	import SelfTrustedPeersPanel from '$lib/self/SelfTrustedPeersPanel.svelte'
	import { useSelfContext } from '$lib/self/self-context.svelte'

	const ctx = useSelfContext()
</script>

<svelte:head>
	<title>{t('self.peers.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('self.peers.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('self.peers.subtitle')}
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<SelfTrustedPeersPanel />
</div>
