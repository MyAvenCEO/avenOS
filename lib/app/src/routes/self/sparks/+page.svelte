<script lang="ts">
	import { browser } from '$app/environment'
	import type { JazzSessionReply } from '$lib/jazz/api'
	import { jazzBootstrap, jazzSession, jazzStatus } from '$lib/jazz/api'
	import { deviceSession } from '$lib/self/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let jazz = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let busy = $state(false)

	const sessionKind = $derived($deviceSession.kind)
	const unlocked = $derived(
		sessionKind === 'unlocked' || sessionKind === 'dev_bypass',
	)
	const tauri = $derived(browser && isTauriRuntime())

	let copySpark = $state(false)

	async function copyUrn(): Promise<void> {
		if (!jazz?.defaultSparkUrn) return
		try {
			await navigator.clipboard.writeText(jazz.defaultSparkUrn)
			copySpark = true
			setTimeout(() => {
				copySpark = false
			}, 1200)
		} catch {
			copySpark = false
		}
	}

	async function loadSession(): Promise<void> {
		if (!tauri || !unlocked) {
			jazz = undefined
			return
		}
		busy = true
		err = undefined
		try {
			const status = await jazzStatus()
			if (!status.ready) {
				await jazzBootstrap()
			}
			jazz = await jazzSession()
		} catch (e) {
			jazz = undefined
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	$effect(() => {
		sessionKind
		browser
		void loadSession()
	})
</script>

<svelte:head>
	<title>Sparks · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Sparks</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			A <span class="font-medium text-foreground">spark</span> is AvenOS / Jazz cryptographic workspace keys, biscuit
			policy roots, and default encryption scope for encrypted tables. First bootstrap provisions one default spark in
			your Groove ledger.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs">
			Spark metadata is surfaced from the AvenOS desktop shell (Tauri + Groove). Open AvenOS desktop to inspect this
			data.
		</p>
	{:else if !unlocked}
		<p class="text-muted-foreground rounded-lg border border-border/60 bg-card/30 px-4 py-3 text-xs leading-relaxed">
			Unlock with Touch ID (or Dev bypass). Groove derives local sparks only while the vault is open.
		</p>
	{:else if err}
		<p class="text-destructive rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs select-text">{err}</p>
	{:else if busy || !jazz}
		<p class="text-muted-foreground text-xs">{busy ? 'Connecting to Jazz…' : 'Loading spark…'}</p>
	{:else}
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-5">
			<h2 class="text-[11px] font-semibold tracking-wider uppercase opacity-70">Default spark</h2>
			<p class="text-muted-foreground text-[11px] leading-relaxed">
				Created locally on first successful jazz bootstrap — every user-data row without an explicit tenant binding
				uses this spark until sharing migrates ownership.
			</p>
			<div class="space-y-1.5">
				<span class="text-muted-foreground text-[10px] uppercase tracking-wider">URN</span>
				<pre
					class="break-all overflow-x-auto rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{jazz.defaultSparkUrn}</pre>
				<button
					type="button"
					class="border-input hover:bg-accent w-fit rounded-md border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
					onclick={() => void copyUrn()}
				>
					{copySpark ? 'Copied URN' : 'Copy URN'}
				</button>
			</div>

			<hr class="border-border/60" />

			<div class="space-y-1.5">
				<h3 class="text-[10px] font-semibold uppercase tracking-wider opacity-70">Aligned peer DID</h3>
				<p class="text-muted-foreground text-[11px] leading-relaxed">
					Same <code class="font-mono">did:key</code> surfaced under Peer IDs · Application signing — this is the DID
					encoded into biscuit access checks for ACC.
				</p>
				<pre
					class="break-all rounded-md border border-border/40 bg-background/50 px-3 py-2 font-mono text-[11px] leading-snug select-text">{jazz.peerDid}</pre>
				{#if jazz.peerDidShort}
					<span class="text-muted-foreground text-[10px]">{jazz.peerDidShort}</span>
				{/if}
			</div>
		</section>
	{/if}
</div>
