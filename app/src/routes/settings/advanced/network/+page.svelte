<script lang="ts">
	import { useSelfContext } from '$lib/settings/self-context.svelte'
	import { t } from '$lib/i18n'
	import { copyToClipboard } from '$lib/runtime/clipboard'

	const ctx = useSelfContext()

	let copyKey = $state<string | null>(null)

	async function copyText(value: string | undefined, key: string): Promise<void> {
		if (!value) return
		const ok = await copyToClipboard(value)
		if (ok) {
			copyKey = key
			setTimeout(() => {
				if (copyKey === key) copyKey = null
			}, 1200)
		} else {
			copyKey = null
		}
	}
</script>

<svelte:head>
	<title>{t('self.network.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('self.network.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('self.network.subtitle')}
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
		<div class="flex items-baseline justify-between gap-3">
			<div>
				<h2 class="text-sm font-medium">{t('self.network.currentNetwork')}</h2>
				<p class="text-muted-foreground text-xs leading-relaxed">
					{t('self.network.currentNetworkDescription')}
				</p>
			</div>
		</div>

		<p
			class="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 font-mono text-[11px] leading-snug select-text"
			aria-readonly="true"
		>
			{ctx.networkSeed}
		</p>
		<button
			type="button"
			class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-[11px] font-medium"
			onclick={() => void copyText(ctx.networkSeed, 'network')}
		>
			{copyKey === 'network' ? t('common.copied') : t('common.copy')}
		</button>
		<p class="text-muted-foreground text-[10px] leading-relaxed">
			{t('self.network.networkNotSwitchable')}
		</p>
	</section>
</div>
