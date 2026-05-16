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
	<title>Peer IDs · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Peer IDs</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			<code class="font-mono text-[11px]">did:key</code> anchors for your hardware-backed P-256 credential and your
			HKDF-derived Ed25519 signing identity (Jazz / ACC).
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
		<div class="flex flex-col">
			<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Device credential</h2>
			<span class="text-muted-foreground text-[10px]"
				>NIST P-256 peer key sealed in Secure Enclave. Private key never exits the chip.</span
			>
		</div>

		<article class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-baseline justify-between gap-3">
				<div class="flex flex-col gap-1">
					<h3 class="text-sm font-medium">Hardware peer</h3>
					{#if ctx.devicePeerDid}
						<p class="break-all font-mono text-[11px] leading-snug select-text text-foreground">
							{ctx.devicePeerDid}
						</p>
					{/if}
				</div>
				<span
					class="shrink-0 rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
					class:opacity-50={!ctx.status?.registered}
				>
					{ctx.status?.registered ? 'registered' : 'not registered'}
				</span>
			</div>

			{#if !ctx.status?.registered}
				<p class="text-muted-foreground text-xs leading-relaxed">
					Unlock once from the lock screen to provision the device keypair.
				</p>
			{:else if ctx.peerPubB64 && ctx.devicePeerDid}
				<span class="text-muted-foreground text-[10px] uppercase tracking-wide"
					>SEC1-encoded public material (offline transcript)</span
				>
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.peerPubB64}</pre>
				<div class="flex items-center justify-between gap-3">
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => void copy('device-did', ctx.devicePeerDid)}
					>
						{copyKey === 'device-did' ? 'Copied' : 'Copy DID'}
					</button>
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => void copy('device-pub', ctx.peerPubB64)}
					>
						{copyKey === 'device-pub' ? 'Copied' : 'Copy transcript'}
					</button>
				</div>
				<span class="text-muted-foreground text-[10px] leading-snug"
					>Device DID (<code class="font-mono">did:key</code>, multicodec <code class="font-mono">p256-pub</code>).</span
				>
			{:else if ctx.peerPubB64}
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.peerPubB64}</pre>
				<p class="text-muted-foreground text-[11px]">Computing device DID failed — raw transcript shown above.</p>
			{:else}
				<p class="text-muted-foreground text-xs">Loading…</p>
			{/if}
		</article>

		<article class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<div class="flex items-baseline justify-between gap-3">
				<div class="flex flex-col gap-1">
					<h3 class="text-sm font-medium">Application signing (Ed25519)</h3>
					{#if ctx.signingPeerDid}
						<p class="break-all font-mono text-[11px] leading-snug select-text text-foreground">
							{ctx.signingPeerDid}
						</p>
					{/if}
				</div>
				<span
					class="shrink-0 rounded-full border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px]"
					class:opacity-50={!ctx.status?.unlocked}
				>
					{ctx.status?.unlocked ? 'derived' : 'locked'}
				</span>
			</div>

			{#if !ctx.status?.unlocked}
				<p class="text-muted-foreground text-xs leading-relaxed">
					Unlock with Touch ID so AvenOS can derive this Ed25519 key from your device root in memory only.
				</p>
			{:else if ctx.signingPubB64 && ctx.signingPeerDid}
				<span class="text-muted-foreground text-[10px] uppercase tracking-wide">Raw verifying key bytes (base64)</span>
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.signingPubB64}</pre>
				<div class="flex flex-wrap items-center justify-between gap-3">
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => void copy('signing-did', ctx.signingPeerDid)}
					>
						{copyKey === 'signing-did' ? 'Copied' : 'Copy DID'}
					</button>
					<button
						type="button"
						class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
						onclick={() => void copy('signing-pub', ctx.signingPubB64)}
					>
						{copyKey === 'signing-pub' ? 'Copied' : 'Copy bytes'}
					</button>
				</div>
				<span class="text-muted-foreground text-[10px] leading-snug"
					>Jazz ACC subject / signing DID (<code class="font-mono">did:key</code>, multicodec prefix
					<code class="font-mono">ed25519-pub</code> · <code class="font-mono">0xed01</code>).</span
				>
			{:else if ctx.signingPubB64}
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.signingPubB64}</pre>
				<p class="text-muted-foreground text-[11px]">Computing signing DID failed — raw key bytes shown above.</p>
			{:else}
				<p class="text-muted-foreground text-xs">Loading…</p>
			{/if}
		</article>
	</section>
</div>
