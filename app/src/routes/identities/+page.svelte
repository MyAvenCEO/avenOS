<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { createIdentity, type JazzRow } from '$lib/jazz/api'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'

	const identitiesStore = jazzStore('safes')

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	// Snapshot is reactive: peer-sync deltas land in `identitiesStore.rows` automatically.
	const identities = $derived(
		[...identitiesStore.rows].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
	)
	const humans = $derived(identities.filter((i) => i.type === 'human'))
	// `group` rows are internal M9 sub-groups (collection/row crypto groups), not displayed identities.
	const avens = $derived(identities.filter((i) => i.type !== 'human' && i.type !== 'group' && i.type !== 'spark'))
	const sparks = $derived(identities.filter((i) => i.type === 'spark'))
	const loading = $derived(tauri && unlocked && !identitiesStore.loaded && !identitiesStore.error)

	function sparkSubtitle(row: JazzRow): string {
		const id = row.owner
		return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
	}

	let creating = $state(false)
	let createErr = $state<string | undefined>(undefined)
	// Inline create — Tauri's webview blocks window.prompt(), so use a real input.
	let creatingType = $state<'human' | 'aven' | 'spark' | null>(null)
	let newName = $state('')

	function startCreate(type: 'human' | 'aven' | 'spark'): void {
		creatingType = type
		newName = ''
		createErr = undefined
	}
	async function submitCreate(): Promise<void> {
		const name = newName.trim()
		if (!name || !creatingType) return
		creating = true
		createErr = undefined
		try {
			const id = await createIdentity(name, creatingType)
			creatingType = null
			newName = ''
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

{#snippet identityGrid(rows: JazzRow[], type: 'human' | 'aven' | 'spark')}
	<ul class="grid gap-3 sm:grid-cols-2">
		{#each rows as row (row.owner)}
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
			{#if creatingType === type}
				<form
					class="flex min-h-[5.5rem] w-full flex-col gap-2 rounded-xl border border-dashed border-input bg-card/20 px-3 py-3"
					onsubmit={(e) => {
						e.preventDefault()
						void submitCreate()
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={newName}
						placeholder={type === 'human' ? t('identities.namePromptHuman') : type === 'aven' ? t('identities.namePromptAven') : t('identities.namePromptSpark')}
						class="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
						autofocus
						onkeydown={(e) => {
							if (e.key === 'Escape') creatingType = null
						}}
					/>
					<div class="flex items-center gap-2">
						<button
							type="submit"
							class="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={creating || !newName.trim()}>{creating ? t('identities.creating') : t('common.create')}</button
						>
						<button
							type="button"
							class="text-muted-foreground hover:text-foreground px-2 py-1.5 text-xs"
							onclick={() => (creatingType = null)}>{t('common.cancel')}</button
						>
					</div>
				</form>
			{:else}
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground hover:border-border flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-input bg-card/20 px-4 py-4 text-center transition-colors"
					onclick={() => startCreate(type)}
				>
					<span class="text-2xl leading-none">+</span>
					<span class="text-sm font-medium"
						>{type === 'human' ? t('identities.createHuman') : type === 'aven' ? t('identities.createAven') : t('identities.createSpark')}</span
					>
				</button>
			{/if}
		</li>
	</ul>
{/snippet}

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
		<header class="space-y-1.5">
			<h1 class="text-2xl font-semibold tracking-tight">{t('identities.title')}</h1>
			<p class="text-muted-foreground text-sm leading-relaxed">{t('identities.subtitleLead')}</p>
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

			<section class="space-y-3">
				<h2 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">{t('identities.humansSection')}</h2>
				{@render identityGrid(humans, 'human')}
			</section>

			<section class="space-y-3">
				<h2 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">{t('identities.avensSection')}</h2>
				{@render identityGrid(avens, 'aven')}
			</section>

			<section class="space-y-3">
				<h2 class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">{t('identities.sparksSection')}</h2>
				{@render identityGrid(sparks, 'spark')}
			</section>
		{/if}
	</div>
</div>
