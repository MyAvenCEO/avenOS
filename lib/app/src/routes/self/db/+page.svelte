<script lang="ts">
	import { browser } from '$app/environment'
	import {
		selfClearAvenOsData,
		selfClearJazzDatabase,
		selfStoragePaths,
		type SelfStoragePathsReply,
	} from '$lib/self/storage-api'
	import { applyLockedFrontendState } from '$lib/self/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let paths = $state<SelfStoragePathsReply | undefined>()
	let pathsErr = $state<string | undefined>()
	let busy = $state(false)
	let clearErr = $state<string | undefined>()
	let clearDone = $state(false)
	let confirmOpen = $state(false)
	let fullResetErr = $state<string | undefined>()
	let fullResetDone = $state(false)
	let fullResetConfirmOpen = $state(false)

	const tauri = $derived(browser && isTauriRuntime())

	$effect(() => {
		if (!tauri) {
			paths = undefined
			pathsErr = undefined
			return
		}
		let cancelled = false
		void (async () => {
			try {
				pathsErr = undefined
				clearDone = false
				fullResetDone = false
				const p = await selfStoragePaths()
				if (!cancelled) paths = p
			} catch (e) {
				if (!cancelled) pathsErr = e instanceof Error ? e.message : String(e)
			}
		})()
		return () => {
			cancelled = true
		}
	})

	async function clearDb(): Promise<void> {
		if (!tauri || busy) return
		busy = true
		clearErr = undefined
		clearDone = false
		confirmOpen = false
		try {
			await selfClearJazzDatabase()
			clearDone = true
			paths = await selfStoragePaths()
		} catch (e) {
			clearErr = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function clearAllAvenOsData(): Promise<void> {
		if (!tauri || busy) return
		busy = true
		fullResetErr = undefined
		fullResetDone = false
		fullResetConfirmOpen = false
		try {
			await selfClearAvenOsData()
			applyLockedFrontendState()
			fullResetDone = true
			paths = await selfStoragePaths()
		} catch (e) {
			fullResetErr = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<svelte:head>
	<title>Database · AvenOS</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Local database</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			AvenOS keeps durable state under your OS <strong>Documents</strong> folder in
			<code class="font-mono text-[11px]">.avenOS/</code> (e.g.
			<code class="font-mono text-[11px]">~/Documents/.avenOS</code> on macOS, XDG Documents on Linux).
			Groove/SurrealKV data lives in <code class="font-mono text-[11px]">vaults/&lt;slug&gt;/db/</code>; device
			identity material lives in <code class="font-mono text-[11px]">vaults/&lt;slug&gt;/self/</code>.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open the AvenOS desktop app to manage local storage paths.</p>
	{:else if pathsErr}
		<p
			class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm leading-snug select-text"
			role="alert"
		>
			{pathsErr}
		</p>
	{:else if paths}
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider opacity-70">Paths</h2>
			<dl class="space-y-3 text-[13px]">
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">App root</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.appBase}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">Active vault</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.root}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">Database</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.dbDir}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">Self identity</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.selfIdentityDir}</dd>
				</div>
			</dl>
		</section>

		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider opacity-70">Groove store</h2>
			<p class="text-muted-foreground text-xs leading-relaxed">
				Clearing removes the Groove/SurrealKV database for the active vault (todos, sparks, peers, etc.). Your
				hardware identity under <code class="font-mono text-[11px]">self/</code> is unchanged. After clearing,
				unlock again and open Todos or DB so the store is recreated.
			</p>

			{#if clearErr}
				<p class="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-xs select-text">
					{clearErr}
				</p>
			{/if}
			{#if clearDone}
				<p class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md border px-3 py-2 text-xs">
					Local database cleared. Re-open Todos or trigger bootstrap to create a fresh store.
				</p>
			{/if}

			{#if confirmOpen}
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
					<p class="text-sm font-medium">Delete everything under the database folder?</p>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="border-destructive/60 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={busy}
							onclick={() => void clearDb()}
						>
							{busy ? 'Clearing…' : 'Confirm clear'}
						</button>
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={busy}
							onclick={() => (confirmOpen = false)}
						>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="border-destructive/50 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
					disabled={busy}
					onclick={() => {
						clearErr = undefined
						confirmOpen = true
					}}
				>
					Clear / reset Jazz database…
				</button>
			{/if}
		</section>

		<section
			class="space-y-3 rounded-xl border border-destructive/35 bg-destructive/[0.04] p-4"
		>
			<h2 class="text-destructive text-[11px] font-semibold uppercase tracking-wider">Danger zone</h2>
			<p class="text-muted-foreground text-xs leading-relaxed">
				<strong class="text-foreground font-medium">Full reset</strong> deletes the entire
				<code class="font-mono text-[11px]">.avenOS</code> folder — all vaults, device identity keychains,
				trusted peers, sparks, and schema cache. You will return to the lock screen and must register or unlock
				again. This cannot be undone.
			</p>

			{#if fullResetErr}
				<p class="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-xs select-text">
					{fullResetErr}
				</p>
			{/if}
			{#if fullResetDone}
				<p class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md border px-3 py-2 text-xs">
					All AvenOS local data removed. Register or unlock to start fresh.
				</p>
			{/if}

			{#if fullResetConfirmOpen}
				<div class="flex flex-col gap-3">
					<p class="text-destructive text-sm font-medium">
						Delete <code class="font-mono text-[11px]">{paths.appBase}</code> and lock this device?
					</p>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="border-destructive text-destructive hover:bg-destructive/10 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
							disabled={busy}
							onclick={() => void clearAllAvenOsData()}
						>
							{busy ? 'Deleting…' : 'Yes, delete everything'}
						</button>
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={busy}
							onclick={() => (fullResetConfirmOpen = false)}
						>
							Cancel
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="border-destructive/70 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-50"
					disabled={busy}
					onclick={() => {
						fullResetErr = undefined
						fullResetConfirmOpen = true
					}}
				>
					Delete entire .avenOS folder…
				</button>
			{/if}
		</section>
	{:else}
		<p class="text-muted-foreground text-sm">Loading paths…</p>
	{/if}
</div>
