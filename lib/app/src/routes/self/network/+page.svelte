<script lang="ts">
	import { useSelfContext } from '$lib/self/self-context.svelte'

	const ctx = useSelfContext()

	let copyKey = $state<string | null>(null)

	async function copyGenesis(): Promise<void> {
		if (!ctx.genesisB64) return
		try {
			await navigator.clipboard.writeText(ctx.genesisB64)
			copyKey = 'genesis'
			setTimeout(() => {
				if (copyKey === 'genesis') copyKey = null
			}, 1200)
		} catch {
			copyKey = null
		}
	}
</script>

<svelte:head>
	<title>Network · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Network</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Anchors cryptographic agreement for this deployment. Every AvenOS runtime uses the same
			<code class="font-mono text-[11px]">GENESIS_NETWORK_ID</code> transcript so device keys ECDH deterministically against
			one canonical P-256 point.
		</p>
	</header>

	{#if ctx.statusErr}
		<p
			class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-relaxed select-text"
		>
			{ctx.statusErr}
		</p>
	{/if}

	<section class="space-y-4">
		<div class="flex items-baseline justify-between gap-3">
			<div class="flex flex-col">
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Genesis anchor</h2>
				<span class="text-muted-foreground text-[10px]">SEC1 uncompressed P-256 point (offline constant)</span>
			</div>
			{#if ctx.genesisShort}
				<span
					class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
					>{ctx.genesisShort}</span
				>
			{/if}
		</div>

		<div class="rounded-xl border border-border/60 bg-card/30 p-4">
			{#if ctx.genesisB64}
				<div class="space-y-3">
					<pre
						class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.genesisB64}</pre>
					<div class="flex items-center justify-between gap-3">
						<button
							type="button"
							class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
							onclick={() => void copyGenesis()}
						>
							{copyKey === 'genesis' ? 'Copied' : 'Copy'}
						</button>
						<span class="text-muted-foreground font-mono text-[10px]">GENESIS_NETWORK_ID</span>
					</div>
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">Loading…</p>
			{/if}
		</div>
	</section>
</div>
