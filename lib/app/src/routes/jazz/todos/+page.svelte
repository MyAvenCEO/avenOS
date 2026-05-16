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
	let busy = $state(false)

	const todosApi = jazzTable('todos')

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
		busy = true
		err = undefined
		try {
			await todosApi.create({ title, done: false })
			titleDraft = ''
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function toggle(row: TodosRow): Promise<void> {
		if (!tauri || !unlocked) return
		busy = true
		err = undefined
		try {
			await todosApi.update(row.id, { done: !row.done })
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}

	async function remove(row: TodosRow): Promise<void> {
		if (!tauri || !unlocked) return
		busy = true
		err = undefined
		try {
			await todosApi.delete(row.id)
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
		} finally {
			busy = false
		}
	}
</script>

<svelte:head>
	<title>Jazz todos · AvenOS</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">Jazz todos</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			Local-first rows via the desktop shell — no Jazz runtime in the webview.
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">Open this screen in the AvenOS desktop app to use Jazz IPC.</p>
	{:else if !unlocked}
		<p class="text-muted-foreground text-sm">Unlock with Touch ID to load your local Jazz store.</p>
	{:else}
	{#if session}
				<p class="text-muted-foreground font-mono text-xs leading-snug">
					{session.peerDidShort}
					<span class="mx-2 text-border">·</span>
					<span>{session.defaultSparkUrn}</span>
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
				disabled={busy}
			/>
			<button
				type="submit"
				class="bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
				disabled={busy || !titleDraft.trim()}
			>
				Add
			</button>
		</form>

		<ul class="divide-border/60 divide-y rounded-xl border border-border/60">
			{#each rows as row (row.id)}
				<li class="flex items-start gap-3 px-3 py-3">
					<label class="mt-0.5 flex cursor-pointer items-center gap-2">
						<input
							type="checkbox"
							checked={row.done}
							class="accent-primary h-4 w-4"
							disabled={busy}
							onchange={() => void toggle(row)}
						/>
						<span class:text-muted-foreground={row.done} class:line-through={row.done} class="text-sm">
							{row.title}
						</span>
					</label>
					{#if row.description}
						<p class="text-muted-foreground ml-6 text-xs leading-snug sm:ml-0 sm:flex-1">{row.description}</p>
					{/if}
					<button
						type="button"
						class="text-muted-foreground hover:text-destructive ml-auto text-xs uppercase tracking-wide"
						disabled={busy}
						onclick={() => void remove(row)}
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
