<script lang="ts">
	import { invoke } from '@tauri-apps/api/core'
	import { base64ToBytes, bytesToBase64, useSelfContext } from '$lib/self/self-context.svelte'

	const ctx = useSelfContext()

	let message = $state('Hi, this is me on AvenOS.')
	let sigB64 = $state<string | undefined>()
	let verified = $state<boolean | undefined>()
	let tampered = $state(false)
	let busy = $state(false)
	let err = $state<string | undefined>()

	async function signAndVerify(): Promise<void> {
		if (!ctx.status?.unlocked) return
		busy = true
		err = undefined
		verified = undefined
		tampered = false
		try {
			const msg = Array.from(new TextEncoder().encode(message))
			const sig = await invoke<number[]>('plugin:self|sign', { message: msg })
			sigB64 = bytesToBase64(sig)
			const pk = await invoke<number[]>('plugin:self|signing_public_key')
			verified = await invoke<boolean>('plugin:self|verify', {
				publicKey: pk,
				message: msg,
				signature: sig,
			})
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function tamperVerify(): Promise<void> {
		if (!ctx.status?.unlocked || !sigB64) return
		busy = true
		err = undefined
		tampered = true
		try {
			const alt = Array.from(new TextEncoder().encode(`${message} 🚨`))
			const pk = await invoke<number[]>('plugin:self|signing_public_key')
			verified = await invoke<boolean>('plugin:self|verify', {
				publicKey: pk,
				message: alt,
				signature: base64ToBytes(sigB64),
			})
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<svelte:head>
	<title>Test signature · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Test signature</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Type something. Your Mac signs it with your signing key, then checks the signature is yours.
			The key itself never leaves this device.
		</p>
	</header>

	{#if !ctx.status?.unlocked}
		<p
			class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs leading-relaxed"
		>
			Sign in with Touch ID from the lock screen first.
		</p>
	{:else}
		<section class="space-y-4 rounded-xl border border-border/60 bg-card/30 p-5">
			<label class="flex flex-col gap-2 text-[11px]">
				<span class="text-muted-foreground uppercase tracking-wider">Message</span>
				<textarea
					class="border-input bg-background/60 min-h-[5rem] cursor-text resize-y rounded-md border px-3 py-2 font-mono text-[12px] leading-snug select-text focus:outline-none focus:ring-1"
					bind:value={message}
				></textarea>
			</label>

			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide disabled:opacity-50"
					disabled={busy}
					onclick={() => void signAndVerify()}
				>
					{busy && !tampered ? 'Signing…' : 'Sign &amp; verify'}
				</button>
				<button
					type="button"
					class="border-input hover:bg-accent rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide disabled:opacity-50"
					disabled={!sigB64 || busy}
					onclick={() => void tamperVerify()}
					title="Check the same signature against altered text — should be rejected."
				>
					Try with altered text
				</button>
			</div>

			{#if err}
				<p class="text-destructive text-xs leading-relaxed select-text">{err}</p>
			{/if}

			{#if sigB64}
				<div class="space-y-1.5">
					<span class="text-muted-foreground text-[10px] uppercase tracking-wider">Signature</span>
					<pre
						class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{sigB64}</pre>
				</div>
			{/if}

			{#if verified !== undefined}
				<p
					class="text-[12px] font-medium"
					class:text-emerald-600={verified}
					class:text-destructive={!verified}
				>
					{#if verified}
						✓ This signature is yours.
					{:else if tampered}
						✗ Doesn't match — the text was changed after signing.
					{:else}
						✗ Doesn't match — signature isn't valid for this text.
					{/if}
				</p>
			{/if}
		</section>

		<section class="space-y-2 rounded-xl border border-border/60 bg-card/30 p-5">
			<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">
				Your signing key
			</h2>
			{#if ctx.signingPubB64}
				<p class="text-muted-foreground text-[11px] leading-relaxed">
					Anyone with this key can confirm a signature came from you. Safe to share.
				</p>
				<pre
					class="overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{ctx.signingPubB64}</pre>
			{/if}
		</section>
	{/if}
</div>
