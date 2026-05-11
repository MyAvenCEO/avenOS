<script lang="ts">
import { getJazzContext, QuerySubscription } from 'jazz-tools/svelte'
import { page } from '$app/stores'
import { app } from '$lib/schema'
import { workspaceContentClass } from '$lib/workspace/layout'

const ctx = getJazzContext()
const profiles = new QuerySubscription(app.profiles.limit(1))

let profileSeedForUser = $state<string | null>(null)
let nameDraft = $state('')

$effect(() => {
	if ($page.url.pathname !== '/me') return
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

function syncDisplayName() {
	const p = profile
	if (!p) return
	const db = ctx.db
	if (!db) return
	const next = nameDraft.trim()
	if (next === p.name) return
	try {
		db.update(app.profiles, p.id, { name: next || 'You' })
	} catch {
		/* Jazz mutation errors surface via db.onMutationError */
	}
}

async function logOut() {
	const db = ctx.db
	if (db) await db.logout()
}
</script>

<header class={`mb-8 grid grid-cols-3 items-center gap-x-2 gap-y-3 ${workspaceContentClass}`}>
	<div class="min-w-0" aria-hidden="true"></div>

	<nav
		class="flex flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-wider"
		aria-label="Workspace sections"
	>
		<a
			href="/me"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/me'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Me</a
		>
		<span class="opacity-25 select-none" aria-hidden="true">|</span>
		<a
			href="/talk"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/talk'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Talk</a
		>
		<span class="opacity-25 select-none" aria-hidden="true">|</span>
		<a
			href="/memory"
			class="uppercase opacity-40 transition-opacity hover:opacity-80 {$page.url.pathname === '/memory'
				? 'opacity-95 underline underline-offset-4'
				: ''}"
			>Brain</a
		>
	</nav>

	<div class="flex min-w-0 items-center justify-end justify-self-end gap-2 sm:gap-3">
		{#if profiles.loading}
			<span class="text-xl font-medium tracking-tight opacity-30 tabular-nums">…</span>
		{:else if profiles.error}
			<span class="truncate text-sm text-error" title={profiles.error.message}>!</span>
		{:else if profile}
			<input
				type="text"
				class="min-w-0 max-w-full shrink border-0 bg-transparent p-0 text-right text-lg font-medium tracking-tight no-underline shadow-none outline-none ring-0 placeholder:text-foreground/35 focus:border-0 focus:ring-0 focus:outline-none focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/20 sm:text-xl"
				bind:value={nameDraft}
				onblur={() => syncDisplayName()}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.currentTarget.blur()
					}
				}}
				aria-label="Display name"
			>
		{/if}
		<button
			type="button"
			class="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-white/10 transition-all hover:bg-white/30"
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
