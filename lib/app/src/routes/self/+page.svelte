<script lang="ts">
	import { useSelfContext } from '$lib/self/self-context.svelte'

	const ctx = useSelfContext()

	let copyKey = $state<string | null>(null)

	async function copy(label: string, value: string | undefined): Promise<void> {
		if (!value) return
		try {
			await navigator.clipboard.writeText(value)
			copyKey = label
			setTimeout(() => {
				if (copyKey === label) copyKey = null
			}, 1200)
		} catch {
			copyKey = null
		}
	}
</script>

<svelte:head>
	<title>Your identity · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Your identity</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Built into this Mac. No password, no account, no cloud — your identity here is your device.
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
				<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Network</h2>
				<span class="text-muted-foreground text-[10px]"
					>The shared anchor everyone on this network connects through</span
				>
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
				<div class="space-y-2">
					<pre
						class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.genesisB64}</pre>
					<details class="text-muted-foreground text-[11px]">
						<summary class="cursor-pointer select-none">Show as hex</summary>
						<pre
							class="mt-2 overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono leading-snug select-text">{ctx.genesisHex}</pre>
					</details>
					<div class="flex items-center justify-between gap-3">
						<button
							type="button"
							class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
							onclick={() => void copy('genesis', ctx.genesisB64)}
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

	<section class="space-y-4">
		<div class="flex flex-col">
			<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">This device</h2>
			<span class="text-muted-foreground text-[10px]"
				>Two keys, both unique to this Mac. The private halves never leave the chip.</span
			>
		</div>

		<article class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-baseline justify-between gap-3">
				<div class="flex flex-col">
					<h3 class="text-sm font-medium">Device key</h3>
					<span class="text-muted-foreground text-[11px] leading-snug"
						>Locked into your Mac's secure chip. Unlocked with Touch ID.</span
					>
				</div>
				<span
					class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
					class:opacity-50={!ctx.status?.registered}
				>
					{ctx.status?.registered ? 'set up' : 'not yet set up'}
				</span>
			</div>

			{#if !ctx.status?.registered}
				<p class="text-muted-foreground text-xs leading-relaxed">
					Open the lock screen and unlock once to create your device key.
				</p>
			{:else if ctx.peerPubB64}
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.peerPubB64}</pre>
				<details class="text-muted-foreground text-[11px]">
					<summary class="cursor-pointer select-none">Show as hex</summary>
					<pre
						class="mt-2 overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono leading-snug select-text">{ctx.peerPubHex}</pre>
				</details>
				<div class="flex items-center justify-between gap-3">
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => void copy('peer', ctx.peerPubB64)}
					>
						{copyKey === 'peer' ? 'Copied' : 'Copy'}
					</button>
					<span class="text-muted-foreground font-mono text-[10px]">PEER_ID_&lt;device&gt;</span>
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">Loading…</p>
			{/if}
		</article>

		<article class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-baseline justify-between gap-3">
				<div class="flex flex-col">
					<h3 class="text-sm font-medium">Signing key</h3>
					<span class="text-muted-foreground text-[11px] leading-snug"
						>Used to prove your actions are really yours. Lives in memory only while you're signed
						in.</span
					>
				</div>
				<span
					class="rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
					class:opacity-50={!ctx.status?.unlocked}
				>
					{ctx.status?.unlocked ? 'ready' : 'locked'}
				</span>
			</div>

			{#if !ctx.status?.unlocked}
				<p class="text-muted-foreground text-xs leading-relaxed">
					Sign in with Touch ID from the lock screen to derive your signing key.
				</p>
			{:else if ctx.signingPubB64}
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.signingPubB64}</pre>
				<details class="text-muted-foreground text-[11px]">
					<summary class="cursor-pointer select-none">Show as hex</summary>
					<pre
						class="mt-2 overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono leading-snug select-text">{ctx.signingPubHex}</pre>
				</details>
				<div class="flex items-center justify-between gap-3">
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => void copy('signing', ctx.signingPubB64)}
					>
						{copyKey === 'signing' ? 'Copied' : 'Copy'}
					</button>
					<span class="text-muted-foreground font-mono text-[10px]"
						>PEER_ID_&lt;device&gt;_ED25519</span
					>
				</div>
			{:else}
				<p class="text-muted-foreground text-xs">Loading…</p>
			{/if}
		</article>
	</section>
</div>
