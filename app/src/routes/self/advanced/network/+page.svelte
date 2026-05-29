<script lang="ts">
	import { useSelfContext } from '$lib/self/self-context.svelte'
	import { copyToClipboard } from '$lib/runtime/clipboard'

	const ctx = useSelfContext()

	let copyGenesisKey = $state<string | null>(null)

	async function copyText(value: string | undefined, key: string): Promise<void> {
		if (!value) return
		const ok = await copyToClipboard(value)
		if (ok) {
			copyGenesisKey = key
			setTimeout(() => {
				if (copyGenesisKey === key) copyGenesisKey = null
			}, 1200)
		} else {
			copyGenesisKey = null
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
			Advanced network constants for debugging and developer docs. You don&apos;t need these for everyday use.
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
				<h2 class="text-sm font-medium">Genesis network ID</h2>
				<p class="text-muted-foreground text-xs leading-relaxed">
					Shared anchor every AvenOS device uses when deriving your device secret.
				</p>
			</div>
			{#if ctx.genesisShort}
				<span class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]">
					{ctx.genesisShort}
				</span>
			{/if}
		</div>

		{#if ctx.genesisB64}
			<p class="break-all font-mono text-[11px] leading-snug select-text">{ctx.genesisB64}</p>
			<button
				type="button"
				class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-[11px] font-medium"
				onclick={() => void copyText(ctx.genesisB64, 'genesis')}
			>
				{copyGenesisKey === 'genesis' ? 'Copied' : 'Copy'}
			</button>
			<p class="text-muted-foreground text-[10px] leading-relaxed">
				SEC1-encoded NIST P-256 public point (offline constant). Feeds HKDF with your Secure Enclave key.
			</p>
		{:else}
			<p class="text-muted-foreground text-xs">Loading…</p>
		{/if}
	</section>

	<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
		<div class="flex items-baseline justify-between gap-3">
			<div>
				<h2 class="text-sm font-medium">Central relay (P2P)</h2>
				<p class="text-muted-foreground text-xs leading-relaxed">
					Blind-relay public key baked into this build. Same value as <code class="font-mono text-[10px]">AVENOS_RELAY_PUBLIC_KEY_HEX</code> in repo <code class="font-mono text-[10px]">.env</code>.
				</p>
			</div>
			{#if ctx.relayUrl}
				<span class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]">
					{ctx.relayUrl}
				</span>
			{/if}
		</div>

		{#if ctx.relayPublicKeyHex}
			<p class="break-all font-mono text-[11px] leading-snug select-text">{ctx.relayPublicKeyHex}</p>
			<button
				type="button"
				class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-[11px] font-medium"
				onclick={() => void copyText(ctx.relayPublicKeyHex, 'relay-pk')}
			>
				{copyGenesisKey === 'relay-pk' ? 'Copied' : 'Copy'}
			</button>
			{#if ctx.dhtBootstrap}
				<p class="text-muted-foreground text-[10px] leading-relaxed">
					DHT bootstrap: <span class="font-mono select-text">{ctx.dhtBootstrap}</span>
				</p>
			{/if}
			{#if ctx.relayAddr}
				<p class="text-muted-foreground text-[10px] leading-relaxed">
					Blind-relay UDP: <span class="font-mono select-text">{ctx.relayAddr}</span>
				</p>
			{/if}
		{:else}
			<p class="text-muted-foreground text-xs">Not embedded (public Hyperswarm mode or dev without relay env).</p>
		{/if}
	</section>
</div>
