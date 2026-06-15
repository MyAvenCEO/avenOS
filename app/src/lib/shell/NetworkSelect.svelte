<script lang="ts">
import { t } from '$lib/i18n'
import type { NetworkId } from '$lib/settings/network'
import { selectNetwork } from '$lib/settings/network-store'

const options: { id: NetworkId; tagKey: string; titleKey: string; bodyKey: string }[] = [
	{
		id: 'testnet',
		tagKey: 'networkSelect.testnet.tag',
		titleKey: 'networkSelect.testnet.title',
		bodyKey: 'networkSelect.testnet.body'
	},
	{
		id: 'mainnet',
		tagKey: 'networkSelect.mainnet.tag',
		titleKey: 'networkSelect.mainnet.title',
		bodyKey: 'networkSelect.mainnet.body'
	}
]

function choose(id: NetworkId): void {
	selectNetwork(id)
}
</script>

<div class="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-background p-6">
	<div class="w-full max-w-3xl">
		<div class="mb-8 text-center">
			<p
				class="text-muted-foreground text-[10px] font-bold tracking-[0.2em] uppercase"
			>
				{t('networkSelect.kicker')}
			</p>
			<h1 class="font-display mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
				{t('networkSelect.title')}
			</h1>
			<p class="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
				{t('networkSelect.subtitle')}
			</p>
		</div>

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			{#each options as option (option.id)}
				<button
					type="button"
					class="border-border bg-card hover:border-primary/60 hover:bg-card/80 group flex flex-col rounded-[var(--radius-lg)] border p-5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
					onclick={() => choose(option.id)}
				>
					<span
						class="text-primary text-[10px] font-bold tracking-[0.18em] uppercase"
					>
						{t(option.tagKey)}
					</span>
					<span class="font-display mt-2 text-lg font-medium tracking-tight">
						{t(option.titleKey)}
					</span>
					<span class="text-muted-foreground mt-1.5 text-[13px] leading-relaxed">
						{t(option.bodyKey)}
					</span>
					<span
						class="text-primary mt-4 text-xs font-semibold opacity-0 transition-opacity group-hover:opacity-100"
					>
						{t('networkSelect.enter')} →
					</span>
				</button>
			{/each}
		</div>
	</div>
</div>
