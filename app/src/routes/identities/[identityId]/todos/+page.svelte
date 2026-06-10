<script lang="ts">
	/**
	 * Identity todos — rendered through the dynamic JSON `todos` vibe (aven-ui) instead of a
	 * hardcoded Svelte list. The host owns the data + mutations: `source` is derived live from the
	 * `todos` Jazz table (a mutation updates `rows` → `source` re-derives → the view re-mounts with
	 * fresh state), and view events (ADD_ITEM / TOGGLE_ITEM / DELETE_ITEM / CLEAR_DONE) are handled
	 * here against the Jazz store. Same data + agent tools as before, now a portable JSON UI.
	 */
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import type { UiEvent } from '@avenos/aven-ui'
	import { createTodosShell } from '@avenos/aven-ui/vibes/todos'
	import AvenUiView from '$lib/aven-ui/AvenUiView.svelte'
	import { t } from '$lib/i18n'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'

	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const decodedIdentityId = $derived(decodeURIComponent(identityParam))

	let err = $state<string | undefined>()
	let busy = $state(false)

	const identitiesStore = jazzStore('safes')
	const todos = jazzStore('todos')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const identityMeta = $derived(
		identitiesStore.rows.find((s) => idsMatch(s.owner, decodedIdentityId)),
	)
	const sparksResolved = $derived(identitiesStore.loaded)
	const canonicalSparkId = $derived(identityMeta?.owner ?? decodedIdentityId)
	const rows = $derived(todos.rows.filter((r) => idsMatch(r.owner, canonicalSparkId)))

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	const storeError = $derived(identitiesStore.error ?? todos.error)
	$effect(() => {
		if (storeError) err = storeError
	})

	const shell = createTodosShell()

	// The vibe's `source`: title + items ([{id,text,done}]) + labels. Re-derives on any todos
	// mutation, which re-mounts the view with the live list.
	const source = $derived({
		title: t('identities.todos.title'),
		items: rows.map((r) => ({ id: String(r.id), text: String(r.title ?? ''), done: r.done === true })),
		labels: {
			listEyebrow: t('identities.todos.listEyebrow'),
			openLabel: t('identities.todos.openLabel'),
			newSection: t('identities.todos.newSection'),
			entriesSection: t('identities.todos.entriesSection'),
			addPlaceholder: t('identities.todos.newTodoPlaceholder'),
			addButton: t('common.add'),
			clearDone: t('identities.todos.clearDone'),
			toggleAria: t('identities.todos.toggleDone'),
			deleteAria: t('common.delete'),
			emptyList: t('identities.todos.noTodosYet'),
		},
	})

	async function handleEvent(event: UiEvent): Promise<void> {
		if (!tauri || !unlocked || !canonicalSparkId || busy) return
		busy = true
		err = undefined
		try {
			if (event.send === 'ADD_ITEM') {
				const title = String(event.payload?.text ?? '').trim()
				if (title) await todos.create({ title, done: false, owner: canonicalSparkId })
			} else if (event.send === 'TOGGLE_ITEM') {
				const id = String(event.payload?.id ?? '')
				const row = rows.find((r) => String(r.id) === id)
				if (row) await todos.update(row.id, { done: !row.done })
			} else if (event.send === 'DELETE_ITEM') {
				const id = String(event.payload?.id ?? '')
				const row = rows.find((r) => String(r.id) === id)
				if (row) await todos.delete(row.id)
			} else if (event.send === 'CLEAR_DONE') {
				for (const row of rows.filter((r) => r.done === true)) await todos.delete(row.id)
			}
			// SET_DRAFT is DOM-local (the input holds its own value) — no host action needed.
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<svelte:head>
	<title>{t('identities.todos.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col gap-4">
	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.todos.unlockToLoad')}</p>
	{:else if !decodedIdentityId}
		<p class="text-muted-foreground text-sm">{t('identities.todos.missingSparkId')}</p>
	{:else}
		{#if err}
			<p
				class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm leading-snug"
				role="alert"
			>
				{err}
			</p>
		{/if}

		{#if !sparksResolved && !err}
			<p class="text-muted-foreground text-xs">{t('common.loadingSpark')}</p>
		{:else if sparksResolved && !identityMeta && !err}
			<p class="text-muted-foreground text-sm">
				{t('identities.todos.notInLedger')}
				<button type="button" class="underline" onclick={() => goto('/identities')}>{t('identities.todos.backToSparks')}</button>.
			</p>
		{:else if identityMeta}
			<div class="flex min-h-0 flex-1 flex-col">
				<AvenUiView {shell} {source} onEvent={handleEvent} containerName="aven-ui-identity-todos" />
			</div>
		{/if}
	{/if}
</div>
