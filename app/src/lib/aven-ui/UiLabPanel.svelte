<script lang="ts">
	import AvenUiView from '$lib/aven-ui/AvenUiView.svelte'
	import { vibeViewById, vibeViewList, type VibeViewId } from '$lib/aven-ui/vibe-views'
	import { t } from '$lib/i18n'

	type Panel = 'render' | 'view' | 'style' | 'state' | 'logic' | 'source'

	let panel = $state<Panel>('render')
	let selectedId = $state<VibeViewId>('invoice')
	let runtimeState = $state<Record<string, unknown> | null>(null)

	const selected = $derived(vibeViewById(selectedId))
	const shell = $derived(selected.shell)

	const jsonPanels: Panel[] = ['view', 'style', 'state', 'logic', 'source']

	function jsonFor(panelId: Panel): string {
		if (panelId === 'view') return JSON.stringify(shell.view, null, 2)
		if (panelId === 'style') return JSON.stringify(shell.style, null, 2)
		if (panelId === 'source') return JSON.stringify(shell.source, null, 2)
		if (panelId === 'logic') return shell.logic
		return JSON.stringify(runtimeState ?? {}, null, 2)
	}

	function selectView(id: VibeViewId) {
		if (id === selectedId) return
		runtimeState = null
		selectedId = id
	}
</script>

<div class="flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
	<aside class="shrink-0 md:min-h-0">
		<p class="text-muted-foreground mb-2 px-1 text-[10px] font-bold tracking-wider uppercase">
			{t('uiLab.snippetCategory')}
		</p>
		<nav class="flex flex-row gap-2 md:flex-col md:gap-1.5" aria-label={t('uiLab.snippetCategory')}>
			{#each vibeViewList as view, i (view.id)}
				{@const active = selectedId === view.id}
				<button
					type="button"
					class="group flex items-center gap-2.5 rounded-full border px-3.5 py-2 text-left text-sm font-medium tracking-tight transition-colors md:w-full {active
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-border text-foreground/80 hover:border-primary/40 hover:bg-accent/5'}"
					aria-current={active ? 'page' : undefined}
					onclick={() => selectView(view.id)}
				>
					<span
						class="text-[11px] font-semibold tabular-nums tracking-wider {active
							? 'text-primary-foreground/70'
							: 'text-muted-foreground/60'}"
					>
						{String(i + 1).padStart(2, '0')}
					</span>
					<span class="truncate">{view.label}</span>
				</button>
			{/each}
		</nav>
		<p class="text-muted-foreground mt-3 hidden px-1 text-xs leading-snug md:block">
			{selected.description}
		</p>
	</aside>

	<div class="flex min-h-0 min-w-0 flex-1 flex-col gap-4">
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

		<div
			class="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-lg)] bg-white/10 {panel ===
			'render'
				? ''
				: 'hidden'}"
		>
			{#key selectedId}
				<AvenUiView
					shell={shell}
					containerName={selected.containerName}
					interactive={selected.interactive}
					onState={(s) => (runtimeState = s)}
					class="p-1"
				/>
			{/key}
		</div>

		{#if panel === 'logic'}
			<pre
				class="min-h-[480px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-dotted border-border/40 bg-black/20 p-4 text-xs leading-relaxed whitespace-pre-wrap text-foreground/90"
			>{jsonFor(panel)}</pre>
		{:else if panel !== 'render'}
			<p class="text-muted-foreground px-1 text-xs leading-snug">
				{panel === 'source' ? t('uiLab.panelSourceHint') : panel === 'state' ? t('uiLab.panelStateHint') : ''}
			</p>
			<pre
				class="min-h-[480px] flex-1 overflow-auto rounded-[var(--radius-lg)] border border-dotted border-border/40 bg-black/20 p-4 text-xs leading-relaxed text-foreground/90"
			>{jsonFor(panel)}</pre>
		{/if}
	</div>
</div>
