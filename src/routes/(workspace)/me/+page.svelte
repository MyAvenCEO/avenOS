<script lang="ts">
import { getJazzContext, QuerySubscription } from 'jazz-tools/svelte'
import { defaultInferenceSnapshot } from '$lib/aven/bootstrap-defaults'
import type { ClassifyIntentArgs } from '$lib/aven/intent-request'
import { app } from '$lib/schema'
import {
	isWorkerCategoryKey,
	randomWorkerCategoryKey,
	WORKER_CATEGORY_LABELS
} from '$lib/worker-catalog'
import { workspaceContentClass } from '$lib/workspace/layout'

/** Must read context here — `getDb()`/`getSession()` call `getContext` and cannot run inside `$effect`. */
const ctx = getJazzContext()

const intents = new QuerySubscription(app.intents)
const workersQuery = new QuerySubscription(() => {
	const uid = ctx.session?.user_id
	if (!uid) return undefined
	return app.workers.where({ ownerUserId: uid })
})

let newTitle = $state('')

let writeError = $state<string | null>(null)
let avenError = $state<string | null>(null)
let avenLoading = $state(false)
let lastClassification = $state<ClassifyIntentArgs | null>(null)

$effect(() => {
	const db = ctx.db
	if (!db) return
	const off = db.onMutationError((ev) => {
		writeError = ev.reason ? `${ev.code}: ${ev.reason}` : ev.code
	})
	return off
})

function spawnWorkerFromClassification(intentTitle: string, c: ClassifyIntentArgs) {
	const db = ctx.db
	const uid = ctx.session?.user_id
	if (!db || !uid) return
	const key = isWorkerCategoryKey(c.worker_class) ? c.worker_class : randomWorkerCategoryKey()
	const base = WORKER_CATEGORY_LABELS[key]
	const label =
		c.worker_mode === 'spawn' && c.spawn_worker_display_name?.trim()
			? `${base} · ${c.spawn_worker_display_name.trim()}`
			: base
	const taskLine = (c.request_title || intentTitle).slice(0, 200)
	db.insert(app.workers, {
		ownerUserId: uid,
		categoryKey: key,
		label,
		taskLine,
		status: c.worker_mode === 'spawn' ? 'Spawn' : 'Active',
		score: (0.55 + Math.random() * 0.44).toFixed(2)
	})
}

async function classifyAndSpawnWorker(intentTitle: string) {
	const origin =
		typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''
	const res = await fetch(`${origin}/api/aven/intent`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			intent: intentTitle,
			snapshot: defaultInferenceSnapshot()
		})
	})
	const data: unknown = await res.json().catch(() => null)
	if (!res.ok || data === null || typeof data !== 'object') {
		const err =
			data !== null &&
			typeof data === 'object' &&
			'error' in data &&
			typeof (data as { error: unknown }).error === 'string'
				? (data as { error: string }).error
				: `Classification failed (${res.status})`
		throw new Error(err)
	}
	if (!('ok' in data) || !(data as { ok: unknown }).ok) {
		const err =
			'error' in data && typeof (data as { error: unknown }).error === 'string'
				? (data as { error: string }).error
				: 'Classification failed'
		throw new Error(err)
	}
	const classification = (data as { classification?: unknown }).classification
	if (!classification || typeof classification !== 'object') {
		throw new Error('Missing classification')
	}
	const c = classification as ClassifyIntentArgs
	spawnWorkerFromClassification(intentTitle, c)
	lastClassification = c
}

async function addIntent() {
	writeError = null
	avenError = null
	const title = newTitle.trim()
	if (!title) return
	const db = ctx.db
	if (!db) return
	db.insert(app.intents, { title, done: false })
	newTitle = ''
	avenLoading = true
	try {
		await classifyAndSpawnWorker(title)
	} catch (e) {
		avenError = e instanceof Error ? e.message : String(e)
		lastClassification = null
	} finally {
		avenLoading = false
	}
}

function toggleIntent(row: { id: string; done: boolean }) {
	writeError = null
	const db = ctx.db
	if (!db) return
	db.update(app.intents, row.id, { done: !row.done })
}

function removeIntent(id: string) {
	writeError = null
	const db = ctx.db
	if (!db) return
	db.delete(app.intents, id)
}

function truncate(s: string, max: number) {
	return s.length <= max ? s : `${s.slice(0, max)}…`
}
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap"
		rel="stylesheet"
	>
	<title>My workspace — Aven Maia</title>
</svelte:head>

<div class="flex flex-1 flex-col min-h-0 overflow-y-auto">
	{#if writeError}
		<div
			class={`${workspaceContentClass} mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error`}
			role="alert"
		>
			{writeError}
			<button
				type="button"
				class="ml-2 underline font-medium"
				onclick={() => {
					writeError = null
				}}
			>
				Schließen
			</button>
		</div>
	{/if}

	{#if avenError}
		<div
			class={`${workspaceContentClass} mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error`}
			role="alert"
		>
			{avenError}
			<button
				type="button"
				class="ml-2 underline font-medium"
				onclick={() => {
					avenError = null
				}}
			>
				Schließen
			</button>
		</div>
	{/if}

	<main class={`${workspaceContentClass} flex-1`}>
		<div
			class="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10 lg:gap-12 items-start"
		>
			<div class="min-w-0 space-y-10">
				<section>
					<div class="flex items-center gap-2 mb-6">
						<span class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]"
							>My Intents</span
						>
					</div>
					<div class="space-y-0">
						{#if intents.error}
							<p class="text-error text-sm">{intents.error.message}</p>
						{:else if intents.loading}
							{#each [1, 2, 3] as _}
								<div class="tech-row animate-pulse">
									<div class="h-6 w-48 bg-black/5 rounded"></div>
									<div class="h-6 w-12 bg-black/5 rounded-full"></div>
								</div>
							{/each}
						{:else}
							{#each intents.current ?? [] as intent, i (intent.id)}
								<div class="tech-row group">
									<div class="flex items-center gap-8 min-w-0">
										<span class="font-mono text-[10px] opacity-20 shrink-0">0{i + 1}</span>
										<span
											class="text-lg font-medium tracking-tight truncate {intent.done ? 'opacity-20 line-through' : ''}"
										>
											{intent.title}
										</span>
									</div>
									<div class="flex items-center gap-4 shrink-0">
										<button
											type="button"
											onclick={() => toggleIntent(intent)}
											class="px-3 py-1 rounded-full border border-border text-[10px] font-bold uppercase transition-all {intent.done
												? 'bg-foreground text-background'
												: 'hover:bg-foreground hover:text-background'}"
											aria-label={intent.done ? 'Mark intent as open' : 'Mark intent as done'}
											aria-pressed={intent.done}
										>
											{intent.done ? 'Done' : 'Open'}
										</button>
										<button
											type="button"
											onclick={() => removeIntent(intent.id)}
											class="opacity-0 group-hover:opacity-100 transition-all p-1 hover:text-error"
											aria-label="Delete"
										>
											<svg
												class="size-4"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
												viewBox="0 0 24 24"
												aria-hidden="true"
											>
												<path
													stroke-linecap="round"
													stroke-linejoin="round"
													d="M6 18L18 6M6 6l12 12"
												/>
											</svg>
										</button>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>
			</div>

			<aside
				class="min-w-0 lg:sticky lg:top-8 self-start pt-10 border-t border-border/50 lg:pt-0 lg:border-t-0 lg:border-l lg:pl-10 lg:border-border/50"
			>
				<div class="flex items-center gap-2 mb-6">
					<span class="text-[10px] font-bold opacity-30 uppercase tracking-[0.3em]"
						>Active Workers</span
					>
				</div>
				{#if lastClassification?.worker_mode === 'spawn'}
					<div class="tech-card mb-4 flex flex-col gap-2 border-dashed border-foreground/25">
						<span class="tech-label">Spawn signal</span>
						{#if lastClassification.spawn_worker_display_name}
							<span class="text-sm font-bold tracking-tight"
								>{lastClassification.spawn_worker_display_name}</span
							>
						{/if}
						{#if lastClassification.spawn_worker_key}
							<span class="font-mono text-[10px] opacity-40"
								>{lastClassification.spawn_worker_key}</span
							>
						{/if}
						<p class="text-xs leading-relaxed opacity-70 font-mono whitespace-pre-wrap">
							{truncate(lastClassification.instructions, 320)}
						</p>
					</div>
				{/if}
				<div class="flex flex-col gap-4">
					{#if workersQuery.error}
						<p class="text-error text-sm">{workersQuery.error.message}</p>
					{:else if workersQuery.loading}
						{#each [1, 2] as _}
							<div class="tech-card min-h-[52px] animate-pulse bg-black/5 py-3"></div>
						{/each}
					{:else if (workersQuery.current ?? []).length === 0}
						<p class="text-xs opacity-40 leading-relaxed">
							No workers yet. Add an intent — Maia classifies it (Tinfoil) and inserts a worker row.
						</p>
					{:else}
						{#each workersQuery.current ?? [] as worker (worker.id)}
							<div class="tech-card flex items-start justify-between gap-3 py-3 px-4 min-h-0">
								<div class="flex flex-col min-w-0 gap-0.5">
									<span class="tech-label">{worker.label}</span>
									<span class="text-sm font-semibold tracking-tight leading-snug text-balance"
										>{worker.taskLine}</span
									>
								</div>
								<div class="flex items-center gap-2 shrink-0 pt-0.5">
									<span class="text-[10px] font-bold opacity-40">{worker.status}</span>
									<div
										class="worker-status-dot rounded-full {worker.status === 'Active' ||
										worker.status === 'Spawn'
											? 'bg-foreground animate-pulse'
											: 'bg-foreground/20'}"
									></div>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</aside>
		</div>
	</main>

	<!-- Bottom-centered intent composer (aligned with workspace content width). -->
	<div
		class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-6 pt-10 bg-gradient-to-t from-background from-40% via-background/95 to-transparent"
	>
		<div class={`pointer-events-auto w-full ${workspaceContentClass}`}>
			<section class="tech-pill py-3 px-4 sm:px-5 justify-between gap-4 w-full">
				<div class="flex items-center gap-3 flex-1 min-w-0">
					<div
						class="size-9 shrink-0 rounded-full border border-border flex items-center justify-center bg-white/20"
					>
						<svg
							class="size-4"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							viewBox="0 0 24 24"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"
							/>
						</svg>
					</div>
					<form
						class="flex-1 min-w-0"
						onsubmit={(e) => {
							e.preventDefault()
							void addIntent()
						}}
					>
						<input
							bind:value={newTitle}
							placeholder="Add new intent..."
							class="w-full min-w-0 bg-transparent border-none p-0 text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0"
						>
					</form>
				</div>
				<div class="flex items-center gap-3 pl-3 border-l border-border shrink-0">
					<div class="flex flex-col items-end">
						<span class="text-[8px] font-bold uppercase opacity-30">Maia</span>
						<span class="text-xs font-bold uppercase tracking-tighter"
							>{avenLoading ? 'Routing…' : 'Ready'}</span
						>
					</div>
				</div>
			</section>
		</div>
	</div>
</div>
