<script lang="ts">
	import type { Snippet } from 'svelte'
	import TechnicalFold from '$lib/self/TechnicalFold.svelte'

	let {
		badge,
		title,
		description,
		did,
		copied = false,
		onCopy,
		emptyHint,
		technical,
	}: {
		badge?: string
		title: string
		description: string
		did?: string
		copied?: boolean
		onCopy: () => void
		emptyHint?: string
		technical?: Snippet
	} = $props()
</script>

<article class="space-y-2 rounded-xl border border-border/60 bg-card/30 p-4">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0 flex-1 space-y-1.5">
			<div class="flex flex-wrap items-center gap-2">
				{#if badge}
					<span
						class="rounded-full border border-border/60 bg-background/80 px-2 py-0.5 text-[9px] font-bold tracking-[0.12em] uppercase"
					>
						{badge}
					</span>
				{/if}
				<h3 class="text-sm font-medium">{title}</h3>
			</div>
			<p class="text-muted-foreground text-xs leading-relaxed">{description}</p>
		</div>
		{#if did}
			<button
				type="button"
				class="border-input hover:bg-accent hover:text-accent-foreground shrink-0 rounded-md border px-3 py-1.5 text-[11px] font-medium"
				onclick={onCopy}
			>
				{copied ? 'Copied' : 'Copy DID'}
			</button>
		{/if}
	</div>

	{#if did}
		<p class="break-all font-mono text-[11px] leading-snug text-foreground select-text">{did}</p>
		{#if technical}
			<TechnicalFold>
				{@render technical()}
			</TechnicalFold>
		{/if}
	{:else if emptyHint}
		<p class="text-muted-foreground text-xs">{emptyHint}</p>
	{/if}
</article>
