<script lang="ts">
import { getJazzContext, QuerySubscription } from 'jazz-tools/svelte'
import { page } from '$app/stores'
import { app } from '$lib/schema'
import { workspaceContentClass } from '$lib/workspace/layout'

const SECOND_BRAIN_LABEL = 'Second brain'

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
	if ($page.url.pathname !== '/me') return
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
		/* Jazz mutation errors surface via db.onMutationError on /me */
	}
}

async function logOut() {
	const db = ctx.db
	if (db) await db.logout()
}

function titleFor(path: string): string {
	if (path === '/talk') return 'Talk'
	if (path === '/memory') return 'Memory'
	return ''
}
</script>

<header
	class={`mb-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 ${workspaceContentClass}`}
>
	<div class="min-w-0 flex-1">
		<div class="flex flex-col gap-1.5">
			<span class="text-[10px] font-bold uppercase tracking-[0.3em] opacity-30">
				{SECOND_BRAIN_LABEL}
			</span>
			{#if $page.url.pathname === '/me'}
				{#if profiles.loading}
					<span class="text-2xl font-medium tracking-tight opacity-25">…</span>
				{:else if profiles.error}
					<span class="text-sm text-error">{profiles.error.message}</span>
				{:else if profile}
					<input
						type="text"
						class="w-full max-w-[12rem] border-b border-border/45 bg-transparent pb-0.5 text-2xl font-medium tracking-tight outline-none focus:border-border focus:ring-0 sm:max-w-[14rem]"
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
					<span class="text-2xl font-medium tracking-tight opacity-25">…</span>
				{/if}
			{:else}
				<h1 class="text-2xl font-medium tracking-tight">{titleFor($page.url.pathname)}</h1>
			{/if}
		</div>
	</div>

	<div class="flex shrink-0 items-center gap-3 sm:gap-4">
		<nav
			class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold uppercase tracking-wider"
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
				>Memory</a
			>
		</nav>
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
