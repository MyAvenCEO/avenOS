<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { createIdentity, type JazzRow } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'

	const identitiesStore = jazzStore('identities')

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked',
	)
	const tauri = $derived(browser && isTauriRuntime())

	// Snapshot is reactive: peer-sync deltas land in `identitiesStore.rows` automatically.
	// avenCEO (the network roster identity, now server-owned) appears as a normal identity
	// in the list once this device is a member; the app-shell gate handles access.
	const identities = $derived(
		[...identitiesStore.rows].sort((a, b) => a.name.localeCompare(b.name)),
	)
	const loading = $derived(tauri && unlocked && !identitiesStore.loaded && !identitiesStore.error)

	function sparkSubtitle(row: JazzRow): string {
		const id = row.owner
		return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
	}

	let creating = $state(false)
	let createErr = $state<string | undefined>(undefined)
	async function createNewIdentity(): Promise<void> {
		const name = (typeof prompt === 'function' ? prompt(t('identities.namePrompt')) : '')?.trim()
		if (!name) return
		creating = true
		createErr = undefined
		try {
			const id = await createIdentity(name)
			await goto(`/identities/${encodeURIComponent(id)}/talk`)
		} catch (e) {
			createErr = e instanceof Error ? e.message : String(e)
		} finally {
			creating = false
		}
	}
</script>

<svelte:head>
	<title>{t('identities.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('identities.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('identities.subtitleLead')}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.unlockToSee')}</p>
	{:else if identitiesStore.error}
		<p class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm" role="alert">{identitiesStore.error}</p>
	{:else if loading}
		<p class="text-muted-foreground text-sm">{t('common.loadingSparks')}</p>
	{:else}
		{#if createErr}
			<p class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm" role="alert">{createErr}</p>
		{/if}
		<ul class="grid gap-3 sm:grid-cols-2">
			{#each identities as row (row.owner)}
				<li>
					<button
						type="button"
						class="group border-input hover:bg-accent hover:text-accent-foreground hover:border-border flex w-full flex-col gap-1 rounded-xl border bg-card/40 px-4 py-4 text-left transition-colors"
						onclick={() => goto(`/identities/${encodeURIComponent(row.owner)}/talk`)}
					>
						<span class="text-[11px] font-semibold tracking-wider uppercase opacity-70 group-hover:text-accent-foreground/90">{t('identities.identityLabel')}</span>
						<span class="text-base font-medium tracking-tight group-hover:text-accent-foreground">{row.name || t('common.unnamed')}</span>
						<span class="text-muted-foreground font-mono text-[11px] group-hover:text-accent-foreground/85">{sparkSubtitle(row)}</span>
					</button>
				</li>
			{/each}
			<li>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground hover:border-border flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input bg-card/20 px-4 py-4 text-center transition-colors disabled:opacity-50"
					onclick={() => void createNewIdentity()}
					disabled={creating}
				>
					<span class="text-2xl leading-none">+</span>
					<span class="text-sm font-medium">{creating ? t('identities.creating') : t('identities.createNew')}</span>
				</button>
			</li>
		</ul>
	{/if}
</div>
</div>
