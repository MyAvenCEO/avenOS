<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import type { SparksRow } from '@avenos/jazz-schema'
	import { jazzTableStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'

	const sparksStore = jazzTableStore('sparks')

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked' || $deviceSession.kind === 'dev_bypass',
	)
	const tauri = $derived(browser && isTauriRuntime())

	// Snapshot is reactive: peer-sync deltas land in `sparksStore.rows` automatically.
	const sparks = $derived(
		[...sparksStore.rows].sort((a, b) => a.name.localeCompare(b.name)),
	)
	const loading = $derived(tauri && unlocked && !sparksStore.loaded && !sparksStore.error)

	function sparkSubtitle(row: SparksRow): string {
		const id = row.spark_id
		return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
	}
</script>

<svelte:head>
	<title>Workspaces · AvenOS</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Workspaces</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Sparks you can open from this Mac — each is an encrypted workspace row in Groove. Open a card for todos. Pair devices and delegate access under
			<a href="/self/workspaces" class="text-primary underline">Self → Sharing</a>.
		</p>
		<p class="text-muted-foreground border-border/50 bg-card/20 rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed">
			<strong class="text-foreground font-medium">Why you might see one card:</strong> Every device bootstraps its own default spark. The other Mac&apos;s spark appears here only after you are a biscuit admin and <strong class="text-foreground font-medium">Groove has synced that spark&apos;s metadata into this replica</strong>
			— keep both apps open and online after granting. Peering alone does not copy the other workspace into this list.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app to load workspaces.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock with Touch ID to load your Groove data.</p>
	{:else if sparksStore.error}
		<p class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm" role="alert">{sparksStore.error}</p>
	{:else if loading}
		<p class="text-muted-foreground text-sm">Loading workspaces…</p>
	{:else if sparks.length === 0}
		<p class="text-muted-foreground text-sm">No sparks yet — jazz bootstrap normally provisions a default spark after unlock.</p>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2">
			{#each sparks as row (row.spark_id)}
				<li>
					<button
						type="button"
						class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors"
						onclick={() => goto(`/sparks/${encodeURIComponent(row.spark_id)}`)}
					>
						<span class="text-[11px] font-semibold tracking-wider uppercase opacity-70 group-hover:text-accent-foreground/90">Workspace</span>
						<span class="text-base font-medium tracking-tight group-hover:text-accent-foreground">{row.name || 'Unnamed spark'}</span>
						<span class="text-muted-foreground font-mono text-[11px] group-hover:text-accent-foreground/85">{sparkSubtitle(row)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>
