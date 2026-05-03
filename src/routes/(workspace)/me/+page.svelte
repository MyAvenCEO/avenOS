<script lang="ts">
import { getJazzContext, QuerySubscription } from 'jazz-tools/svelte'
import { app } from '$lib/schema'
import { randomWorkerCategoryKey, WORKER_CATEGORY_LABELS } from '$lib/worker-catalog'

/** Must read context here — `getDb()`/`getSession()` call `getContext` and cannot run inside `$effect`. */
const ctx = getJazzContext()

const intents = new QuerySubscription(app.intents)
const profiles = new QuerySubscription(app.profiles.limit(1))
const workersQuery = new QuerySubscription(() => {
	const uid = ctx.session?.user_id
	if (!uid) return undefined
	return app.workers.where({ ownerUserId: uid })
})

let newTitle = $state('')
let profileSeedForUser = $state<string | null>(null)
/** Local draft for display name — quickstart-style binding; synced from server row. */
let nameDraft = $state('')

let writeError = $state<string | null>(null)
let jazzResetBusy = $state(false)

$effect(() => {
	const db = ctx.db
	if (!db) return
	const off = db.onMutationError((ev) => {
		writeError = ev.reason ? `${ev.code}: ${ev.reason}` : ev.code
	})
	return off
})

$effect(() => {
	const s = ctx.session
	if (!s) return
	if (profileSeedForUser === s.user_id) return
	const db = ctx.db
	if (!db) return
	void db.all(app.profiles.limit(1)).then((rows) => {
		if (rows.length === 0) {
			db.insert(app.profiles, { name: 'You' })
		}
		profileSeedForUser = s.user_id
	})
})

const profile = $derived(profiles.current?.[0] ?? null)

$effect(() => {
	const p = profile
	if (p) nameDraft = p.name
})

/** Hardcoded test: each new intent spawns a random catalog worker row for the current user. */
function spawnRandomWorkerForIntent(intentTitle: string) {
	const db = ctx.db
	const uid = ctx.session?.user_id
	if (!db || !uid) return
	const key = randomWorkerCategoryKey()
	db.insert(app.workers, {
		ownerUserId: uid,
		categoryKey: key,
		label: `${WORKER_CATEGORY_LABELS[key]} Worker`,
		taskLine: intentTitle.slice(0, 200),
		status: 'Active',
		score: (0.55 + Math.random() * 0.44).toFixed(2)
	})
}

function addIntent() {
	writeError = null
	const title = newTitle.trim()
	if (!title) return
	const db = ctx.db
	if (!db) return
	db.insert(app.intents, { title, done: false })
	spawnRandomWorkerForIntent(title)
	newTitle = ''
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

function syncDisplayName() {
	const p = profile
	if (!p) return
	writeError = null
	const next = nameDraft.trim()
	if (next === p.name) return
	const db = ctx.db
	if (!db) return
	try {
		db.update(app.profiles, p.id, { name: next || 'You' })
	} catch (e) {
		writeError = e instanceof Error ? e.message : String(e)
	}
}

async function logOut() {
	writeError = null
	const db = ctx.db
	if (db) await db.logout()
}

/** Wipes browser OPFS for this Jazz DB (coordinated across tabs). Does not remove local-first auth secret in localStorage. */
async function resetLocalJazzStorage() {
	if (!import.meta.env.DEV) return
	writeError = null
	const db = ctx.db
	if (!db) return
	jazzResetBusy = true
	try {
		await db.deleteClientStorage()
		profileSeedForUser = null
	} catch (e) {
		writeError = e instanceof Error ? e.message : String(e)
	} finally {
		jazzResetBusy = false
	}
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

<div class="min-h-screen bg-background p-6 sm:p-8 pb-10">
	{#if writeError}
		<div
			class="mx-auto max-w-6xl mb-4 rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm text-error"
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

	<header class="mx-auto max-w-6xl flex items-center justify-between mb-8 gap-4">
		<div class="flex flex-col min-w-0">
			<a
				href="/"
				class="text-xs font-bold opacity-30 uppercase tracking-widest mb-1 hover:opacity-50 transition-opacity w-fit"
			>
				Aven Maia
			</a>
			<div class="flex items-center gap-2">
				{#if profiles.loading}
					<span class="text-3xl font-medium tracking-tighter opacity-20">Loading...</span>
				{:else if profiles.error}
					<span class="text-3xl font-medium tracking-tighter text-error"
						>{profiles.error.message}</span
					>
				{:else if profile}
					<input
						type="text"
						class="border-none bg-transparent p-0 text-3xl font-medium tracking-tighter outline-none focus:ring-0 max-w-full"
						bind:value={nameDraft}
						onblur={() => syncDisplayName()}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.currentTarget.blur()
							}
						}}
						aria-label="Display name"
					>
				{:else}
					<span class="text-3xl font-medium tracking-tighter opacity-20">Loading...</span>
				{/if}
			</div>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			{#if import.meta.env.DEV}
				<button
					type="button"
					class="text-[10px] font-bold uppercase tracking-wider opacity-40 hover:opacity-70 px-2 py-1 rounded border border-border/60 disabled:opacity-20"
					disabled={jazzResetBusy || ctx.db == null}
					onclick={() => void resetLocalJazzStorage()}
					title="Clears Jazz browser storage (OPFS) after schema changes. Keeps your local-first login secret."
				>
					{jazzResetBusy ? '…' : 'Reset DB'}
				</button>
			{/if}
			<button
				type="button"
				class="size-10 shrink-0 flex items-center justify-center rounded-full border border-border bg-white/10 hover:bg-white/30 transition-all"
				onclick={() => void logOut()}
				aria-label="Log out"
			>
				<svg
					class="size-5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9"
					/>
				</svg>
			</button>
		</div>
	</header>

	<main class="mx-auto max-w-6xl">
		<div
			class="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-10 lg:gap-12 items-start"
		>
			<div class="min-w-0 space-y-10">
				<section class="tech-pill py-2.5 px-4 justify-between">
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
						<form class="flex-1 min-w-0" onsubmit={(e) => { e.preventDefault(); addIntent(); }}>
							<input
								bind:value={newTitle}
								placeholder="Add new intent..."
								class="w-full bg-transparent border-none p-0 text-xl font-medium tracking-tight placeholder:opacity-20 outline-none focus:ring-0"
							>
						</form>
					</div>
					<div class="flex items-center gap-3 pl-3 border-l border-border shrink-0">
						<div class="flex flex-col items-end">
							<span class="text-[8px] font-bold uppercase opacity-30">Maia</span>
							<span class="text-xs font-bold uppercase tracking-tighter">Ready</span>
						</div>
					</div>
				</section>

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
				<div class="flex flex-col gap-4">
					{#if workersQuery.error}
						<p class="text-error text-sm">{workersQuery.error.message}</p>
					{:else if workersQuery.loading}
						{#each [1, 2] as _}
							<div class="tech-card min-h-[96px] animate-pulse bg-black/5"></div>
						{/each}
					{:else if (workersQuery.current ?? []).length === 0}
						<p class="text-xs opacity-40 leading-relaxed">
							No workers yet. Add an intent — test flow spawns one random worker per intent.
						</p>
					{:else}
						{#each workersQuery.current ?? [] as worker (worker.id)}
							<div class="tech-card flex flex-col justify-between min-h-[128px]">
								<div class="flex justify-between items-start gap-3">
									<div class="flex flex-col min-w-0">
										<span class="tech-label">{worker.label}</span>
										<span class="text-sm font-bold tracking-tight leading-snug"
											>{worker.taskLine}</span
										>
										<span class="font-mono text-[10px] opacity-35 mt-1">{worker.categoryKey}</span>
									</div>
									<div class="flex items-center gap-2 shrink-0">
										<span class="text-[10px] font-bold opacity-40">{worker.status}</span>
										<div
											class="worker-status-dot {worker.status === 'Active'
												? 'bg-foreground animate-pulse'
												: 'bg-foreground/20'}"
										></div>
									</div>
								</div>
								<div class="flex justify-between items-end mt-4">
									<div class="flex flex-col">
										<span class="tech-label">Score</span>
										<span class="tech-value text-sm">{worker.score}</span>
									</div>
									<svg
										class="size-4 opacity-10 shrink-0"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
										/>
									</svg>
								</div>
							</div>
						{/each}
					{/if}
				</div>
			</aside>
		</div>
	</main>
</div>

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
