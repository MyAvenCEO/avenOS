<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import type { JazzRow } from '$lib/jazz/api'
	import { jazzShell } from '$lib/runtime/jazz-shell'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/settings/device-session-store'

	const identityParam = $derived(String((page.params as { identityId?: string }).identityId ?? ''))
	const decodedIdentityId = $derived(decodeURIComponent(identityParam))

	const session = $derived($jazzShell.session)
	let err = $state<string | undefined>()
	let titleDraft = $state('')
	let addBusy = $state(false)
	let listBusy = $state(false)

	let editingId = $state<string | null>(null)
	let editDraft = $state('')

	const identitiesStore = jazzStore('identities')
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

	function focusEditable(node: HTMLInputElement) {
		queueMicrotask(() => {
			node.focus()
			node.select()
		})
		return {}
	}

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	const storeError = $derived(identitiesStore.error ?? todos.error)
	$effect(() => {
		if (storeError) err = storeError
	})

	async function addTodo(): Promise<void> {
		const title = titleDraft.trim()
		if (!title || !tauri || !unlocked || !canonicalSparkId) return
		addBusy = true
		err = undefined
		try {
			await todos.create({ title, done: false, owner: canonicalSparkId })
			titleDraft = ''
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			addBusy = false
		}
	}

	function beginEdit(row: JazzRow): void {
		if (!tauri || !unlocked || listBusy || editingId !== null) return
		editingId = row.id
		editDraft = row.title
	}

	function cancelEdit(): void {
		editingId = null
		editDraft = ''
	}

	async function finishTitleEdit(row: JazzRow, reason: 'blur' | 'enter'): Promise<void> {
		if (!tauri || !unlocked || editingId !== row.id) return
		const next = editDraft.trim()
		if (!next) {
			if (reason === 'blur') cancelEdit()
			else err = t('errors.titleCannotBeEmpty')
			return
		}
		if (next === row.title) {
			cancelEdit()
			return
		}
		listBusy = true
		err = undefined
		try {
			await todos.update(row.id, { title: next })
			cancelEdit()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			listBusy = false
		}
	}

	async function toggle(row: JazzRow): Promise<void> {
		if (!tauri || !unlocked) return
		listBusy = true
		err = undefined
		try {
			await todos.update(row.id, { done: !row.done })
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			listBusy = false
		}
	}

	async function remove(row: JazzRow, ev: MouseEvent): Promise<void> {
		ev.stopPropagation()
		if (!tauri || !unlocked) return
		if (editingId === row.id) cancelEdit()
		listBusy = true
		err = undefined
		try {
			await todos.delete(row.id)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			listBusy = false
		}
	}
</script>

<svelte:head>
	<title>{t('identities.todos.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-6">
	<header class="space-y-1">
		<h1 class="text-xl font-semibold tracking-tight">{t('identities.todos.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('identities.todos.subtitle')}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.todos.unlockToLoad')}</p>
	{:else if !decodedIdentityId}
		<p class="text-muted-foreground text-sm">{t('identities.todos.missingSparkId')}</p>
	{:else}
		{#if session}
			<p class="text-muted-foreground font-mono text-xs leading-snug">
				{session.signerDidShort}
				<span class="mx-2 text-border">·</span>
				<span>identity:{canonicalSparkId}</span>
			</p>
		{/if}

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
		{/if}

		{#if identityMeta}
			<form
				class="flex flex-col gap-2 sm:flex-row sm:items-center"
				onsubmit={(e) => {
					e.preventDefault()
					void addTodo()
				}}
			>
				<input
					bind:value={titleDraft}
					placeholder={t('identities.todos.newTodoPlaceholder')}
					class="border-input bg-background focus-visible:ring-ring flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
					disabled={addBusy}
				/>
				<button
					type="submit"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
					disabled={addBusy || !titleDraft.trim()}
				>
					{t('common.add')}
				</button>
			</form>

			<ul class="divide-border/60 divide-y rounded-xl border border-border/60">
				{#each rows as row (row.id)}
					<li class="flex items-start gap-3 px-3 py-3">
						<div class="mt-0.5 flex shrink-0 items-center">
							<input
								type="checkbox"
								aria-label={t('identities.todos.toggleDone')}
								checked={row.done}
								class="accent-primary h-4 w-4 cursor-pointer disabled:opacity-40"
								disabled={listBusy}
								onclick={(e) => {
									e.preventDefault()
									void toggle(row)
								}}
							/>
						</div>
						<div class="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
							<div class="min-w-0 flex-1">
								{#if editingId === row.id}
									<input
										use:focusEditable
										class="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-2 py-1 text-sm outline-none focus-visible:ring-2"
										disabled={listBusy}
										bind:value={editDraft}
										onkeydown={(e) => {
											if (e.key === 'Enter') {
												e.preventDefault()
												void finishTitleEdit(row, 'enter')
											}
											if (e.key === 'Escape') cancelEdit()
										}}
										onblur={() => void finishTitleEdit(row, 'blur')}
									/>
								{:else}
									<button
										type="button"
										class:text-muted-foreground={row.done}
										class="text-left text-sm hover:underline {row.done ? 'line-through' : ''}"
										disabled={listBusy || editingId !== null}
										title={t('identities.todos.doubleClickEdit')}
										ondblclick={() => beginEdit(row)}
									>
										{row.title}
									</button>
								{/if}
							</div>
							{#if row.description}
								<p class="text-muted-foreground max-w-full text-xs leading-snug sm:flex-1">
									{row.description}
								</p>
							{/if}
						</div>
						<button
							type="button"
							class="text-destructive/80 hover:text-destructive shrink-0 self-start pt-0.5 text-xs font-semibold uppercase tracking-wide disabled:opacity-40"
							disabled={listBusy}
							onmousedown={(ev) => ev.preventDefault()}
							onclick={(e) => void remove(row, e)}
						>
							{t('common.delete')}
						</button>
					</li>
				{:else}
					<li class="text-muted-foreground px-3 py-6 text-center text-sm">{t('identities.todos.noTodosYet')}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
