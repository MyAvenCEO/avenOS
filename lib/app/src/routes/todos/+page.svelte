<script lang="ts">
	import { browser } from '$app/environment'
	import type { TodosRow } from '@avenos/jazz-schema'
	import { jazzSession, jazzTable, type JazzSessionReply } from '$lib/jazz/api'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { deviceSession } from '$lib/self/device-session-store'

	let session = $state<JazzSessionReply | undefined>()

	let rows = $state<TodosRow[]>([])
	let err = $state<string | undefined>()
	let titleDraft = $state('')
	let addBusy = $state(false)
	/** Locks list row actions during toggle/delete/edit so we never send overlapping mutations. */
	let listBusy = $state(false)

	let editingId = $state<string | null>(null)
	let editDraft = $state('')

	const todosApi = jazzTable('todos')

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

	$effect(() => {
		if (!tauri || !unlocked) {
			rows = []
			session = undefined
			return
		}

		let cancelled = false
		let unlisten: (() => void) | undefined

		void (async () => {
			try {
				err = undefined
				session = await jazzSession().catch(() => undefined)
				unlisten = await todosApi.subscribe((next) => {
					if (!cancelled) rows = next
				})
			} catch (e) {
				if (!cancelled) err = e instanceof Error ? e.message : String(e)
			}
		})()

		return () => {
			cancelled = true
			unlisten?.()
		}
	})

	async function addTodo(): Promise<void> {
		const title = titleDraft.trim()
		if (!title || !tauri || !unlocked) return
		addBusy = true
		err = undefined
		try {
			await todosApi.create({ title, done: false })
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
	<title>Todos · AvenOS</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Todos</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Local-first rows via the desktop shell — Groove-backed storage in process; no Jazz runtime in the webview.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app to use local todos.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock with Touch ID to load your local database.</p>
	{:else}
	{#if session}
				<p class="text-muted-foreground font-mono text-xs leading-snug">
					{session.peerDidShort}
					<span class="mx-2 text-border">·</span>
					<span>{session.defaultSparkUrn}</span>
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
				<li class="text-muted-foreground px-3 py-6 text-center text-sm">No todos yet.</li>
			{/each}
		</ul>
	{/if}
</div>
