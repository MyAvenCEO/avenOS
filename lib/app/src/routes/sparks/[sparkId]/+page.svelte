<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import type { TodosRow } from '@avenos/jazz-schema'
	import { jazzSession, jazzTable, type JazzSessionReply } from '$lib/jazz/api'
	import { jazzTableStore } from '$lib/jazz/store.svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const decodedSparkId = $derived(decodeURIComponent(sparkParam))

	let session = $state<JazzSessionReply | undefined>()
	let err = $state<string | undefined>()
	let titleDraft = $state('')
	let addBusy = $state(false)
	let listBusy = $state(false)

	let editingId = $state<string | null>(null)
	let editDraft = $state('')

	const todosApi = jazzTable('todos')

	// Reactive stores: rows update on every local CRUD AND every inbound peer-sync delta.
	const sparksStore = jazzTableStore('sparks')
	const todosStore = jazzTableStore('todos')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const sparkMeta = $derived(
		sparksStore.rows.find((s) => idsMatch(s.spark_id, decodedSparkId)),
	)
	const sparksResolved = $derived(sparksStore.loaded)
	const canonicalSparkId = $derived(sparkMeta?.spark_id ?? decodedSparkId)
	const rows = $derived(todosStore.rows.filter((r) => idsMatch(r.spark_id, canonicalSparkId)))

	function focusEditable(node: HTMLInputElement) {
		queueMicrotask(() => {
			node.focus()
			node.select()
		})
		return {}
	}

	const unlocked = $derived(
		$deviceSession.kind === 'unlocked' || $deviceSession.kind === 'dev_bypass',
	)
	const tauri = $derived(browser && isTauriRuntime())

	// Session is one-shot per identity; both stores above subscribe themselves.
	$effect(() => {
		if (!tauri || !unlocked) {
			session = undefined
			return
		}
		let cancelled = false
		void jazzSession()
			.then((s) => {
				if (!cancelled) session = s
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
	})

	const storeError = $derived(sparksStore.error ?? todosStore.error)
	$effect(() => {
		if (storeError) err = storeError
	})

	async function addTodo(): Promise<void> {
		const title = titleDraft.trim()
		if (!title || !tauri || !unlocked || !canonicalSparkId) return
		addBusy = true
		err = undefined
		try {
			await todosApi.create({ title, done: false, spark_id: canonicalSparkId })
			titleDraft = ''
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			addBusy = false
		}
	}

	function beginEdit(row: TodosRow): void {
		if (!tauri || !unlocked || listBusy || editingId !== null) return
		editingId = row.id
		editDraft = row.title
	}

	function cancelEdit(): void {
		editingId = null
		editDraft = ''
	}

	async function finishTitleEdit(row: TodosRow, reason: 'blur' | 'enter'): Promise<void> {
		if (!tauri || !unlocked || editingId !== row.id) return
		const next = editDraft.trim()
		if (!next) {
			if (reason === 'blur') cancelEdit()
			else err = 'Title cannot be empty'
			return
		}
		if (next === row.title) {
			cancelEdit()
			return
		}
		listBusy = true
		err = undefined
		try {
			await todosApi.update(row.id, { title: next })
			cancelEdit()
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			listBusy = false
		}
	}

	async function toggle(row: TodosRow): Promise<void> {
		if (!tauri || !unlocked) return
		listBusy = true
		err = undefined
		try {
			await todosApi.update(row.id, { done: !row.done })
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			listBusy = false
		}
	}

	async function remove(row: TodosRow, ev: MouseEvent): Promise<void> {
		ev.stopPropagation()
		if (!tauri || !unlocked) return
		if (editingId === row.id) cancelEdit()
		listBusy = true
		err = undefined
		try {
			await todosApi.delete(row.id)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			listBusy = false
		}
	}
</script>

<svelte:head>
	<title>{sparkMeta?.name ?? 'Workspace'} · Todos · AvenOS</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
	<header class="space-y-2">
		<button
			type="button"
			class="text-muted-foreground hover:text-foreground text-[11px] font-semibold uppercase tracking-wide"
			onclick={() => goto('/sparks')}
		>
			← All sparks
		</button>
		<div class="flex flex-wrap items-center gap-2">
			<h1 class="text-2xl font-semibold tracking-tight">
				{sparkMeta?.name ?? 'Workspace'} · Todos
			</h1>
			<a
				href="/self/workspaces?spark={encodeURIComponent(decodedSparkId)}"
				class="text-primary hover:underline text-xs font-semibold uppercase tracking-wide"
				>Sharing</a
			>
		</div>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Todos for this spark — pair devices under <strong>Self → Peers &amp; anchor</strong>, grant access under <strong>Self → Sharing</strong>.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock with Touch ID to load your database.</p>
	{:else if !decodedSparkId}
		<p class="text-muted-foreground text-sm">Missing spark id.</p>
	{:else}
		{#if session}
			<p class="text-muted-foreground font-mono text-xs leading-snug">
				{session.peerDidShort}
				<span class="mx-2 text-border">·</span>
				<span>spark:{canonicalSparkId}</span>
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
			<p class="text-muted-foreground text-xs">Loading workspace…</p>
		{:else if sparksResolved && !sparkMeta && !err}
			<p class="text-muted-foreground text-sm">
				No spark matches this id in your ledger —
				<button type="button" class="underline" onclick={() => goto('/sparks')}>back to sparks</button>.
			</p>
		{/if}

		{#if sparkMeta}
			<form
				class="flex flex-col gap-2 sm:flex-row sm:items-center"
				onsubmit={(e) => {
					e.preventDefault()
					void addTodo()
				}}
			>
				<input
					bind:value={titleDraft}
					placeholder="New todo…"
					class="border-input bg-background focus-visible:ring-ring flex-1 rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2"
					disabled={addBusy}
				/>
				<button
					type="submit"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
					disabled={addBusy || !titleDraft.trim()}
				>
					Add
				</button>
			</form>

			<ul class="divide-border/60 divide-y rounded-xl border border-border/60">
				{#each rows as row (row.id)}
					<li class="flex items-start gap-3 px-3 py-3">
						<div class="mt-0.5 flex shrink-0 items-center">
							<input
								type="checkbox"
								aria-label="Toggle done"
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
										title="Double-click to edit"
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
							Delete
						</button>
					</li>
				{:else}
					<li class="text-muted-foreground px-3 py-6 text-center text-sm">No todos in this spark yet.</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
