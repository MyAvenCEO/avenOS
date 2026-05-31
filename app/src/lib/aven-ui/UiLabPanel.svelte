<script lang="ts">
	import { onDestroy } from 'svelte'
	import { AvenUiEngine, type UiBundle, type UiEvent } from '@avenos/aven-ui'
	import { createInvoiceBundle } from '@avenos/aven-ui/fixtures/invoice'
	import { t } from '$lib/i18n'

	type Panel = 'render' | 'view' | 'style' | 'state'

	let host = $state<HTMLElement | null>(null)
	let panel = $state<Panel>('render')
	let engine: AvenUiEngine | null = null
	const bundle = $state<UiBundle>(createInvoiceBundle())

	const jsonPanels: Panel[] = ['view', 'style', 'state']

	function jsonFor(panelId: Panel): string {
		if (panelId === 'view') return JSON.stringify(bundle.view, null, 2)
		if (panelId === 'style') return JSON.stringify(bundle.style, null, 2)
		return JSON.stringify(bundle.state, null, 2)
	}

	$effect(() => {
		if (panel !== 'render' || !host) return
		engine = new AvenUiEngine({
			container: host,
			containerName: 'aven-ui-invoice',
			onEvent: (e: UiEvent) => console.info('[aven-ui]', e),
		})
		void engine.mount(bundle)
		return () => {
			void engine?.unmount()
			engine = null
		}
	})

	onDestroy(() => {
		void engine?.unmount()
		engine = null
	})
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	<div class="flex flex-wrap items-center gap-2">
		<button
			type="button"
			class="rounded-full px-3 py-1 text-[10px] font-bold tracking-wider uppercase transition-opacity {panel ===
			'render'
				? 'bg-foreground text-background opacity-95'
				: 'bg-white/10 opacity-60 hover:opacity-90'}"
			onclick={() => (panel = 'render')}
		>
			{t('uiLab.panelRender')}
		</button>
		{#each jsonPanels as p (p)}
			<button
				type="button"
				class="rounded-full px-3 py-1 text-[10px] font-bold tracking-wider uppercase transition-opacity {panel ===
				p
					? 'bg-foreground text-background opacity-95'
					: 'bg-white/10 opacity-60 hover:opacity-90'}"
				onclick={() => (panel = p)}
			>
				{t(`uiLab.panel${p.charAt(0).toUpperCase()}${p.slice(1)}`)}
			</button>
		{/each}
	</div>

	{#if panel === 'render'}
		<div
			class="mt-5 flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-white/10 sm:mt-6"
		>
			<div bind:this={host} class="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto p-1"></div>
		</div>
	{:else}
		<pre
			class="min-h-[480px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-dotted border-border/40 bg-black/20 p-4 text-xs leading-relaxed text-foreground/90"
		>{jsonFor(panel)}</pre>
	{/if}
</div>
