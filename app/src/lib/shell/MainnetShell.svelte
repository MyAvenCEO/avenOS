<script lang="ts">
import { createQuery, useQueryClient } from '@tanstack/svelte-query'
import { fade, fly } from 'svelte/transition'
import { authClient } from '$lib/auth/auth-client'
import { syncBilling } from '$lib/billing/checkout'
import { fmtMinds } from '$lib/billing/minds'
import DrawCanvas from '$lib/draw/DrawCanvas.svelte'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'
import { fetchUsage } from '$lib/query/usage'
import AccountSettings from '$lib/shell/AccountSettings.svelte'
import MailInbox from '$lib/shell/MailInbox.svelte'
import MainnetChat from '$lib/shell/MainnetChat.svelte'
import MainnetDb from '$lib/shell/MainnetDb.svelte'
import { nav } from '$lib/shell/nav.svelte'

// Mainnet (Alberobello) shell: ONE top nav bar — Chat | Vibes | DB | Fly on the left; weekly
// MINDS + the signed-in account NAME on the right. Clicking the name opens the Account Settings
// view (profile, plans, billing, usage, vault keys, Admin for admins, log out). The website
// Composer lives under Vibes; Skills/Runs live inside the DB viewer. board 0053/0054/0055/0110.
type Tab = 'chat' | 'draw' | 'db' | 'mail'
type SettingsCategory = 'profile' | 'plans' | 'billing' | 'usage' | 'vault' | 'admin'
let tab = $state<Tab>('chat')
let settings = $state(false)
let settingsCategory = $state<SettingsCategory>('profile')

// board 0120 — on mobile the section tabs collapse into a left hamburger slide-menu (the bottom bar
// only has room for the credits + name there). Desktop keeps the inline tab row.
const MOBILE_MQ = '(max-width: 639px)'
let isMobile = $state(false)
let menuOpen = $state(false)
$effect(() => {
	if (typeof window === 'undefined') return
	const mq = window.matchMedia(MOBILE_MQ)
	const sync = () => {
		isMobile = mq.matches
		if (!isMobile) menuOpen = false
	}
	sync()
	mq.addEventListener('change', sync)
	return () => mq.removeEventListener('change', sync)
})

// Honor cross-view deep links (e.g. a flow schema badge → DB tab). board 0083.
$effect(() => {
	if (nav.requestTab) {
		tab = nav.requestTab as Tab
		settings = false
		nav.requestTab = null
	}
})
let checkoutHandled = false
// Shown briefly after returning from a successful Polar checkout (?checkout=success).
let justUpgraded = $state(false)

// Weekly credit (MINDS) for the nav — live via TanStack Query; the SSE 'usage'/'billing' events
// invalidate it, so no manual refresh. board 0055.
const queryClient = useQueryClient()
const usageQuery = createQuery(() => ({ queryKey: qk.usage, queryFn: fetchUsage }))

$effect(() => {
	if (checkoutHandled) return
	checkoutHandled = true
	void (async () => {
		// Returned from Polar checkout? Reconcile the entitlement so the new plan + weekly MINDS
		// appear at once (no wait on a webhook), open Settings → Plans, and clear the flag so a
		// reload doesn't re-trigger.
		const params = new URLSearchParams(window.location.search)
		if (params.get('checkout') === 'success') {
			settings = true
			settingsCategory = 'plans'
			justUpgraded = true
			await syncBilling()
			void queryClient.invalidateQueries({ queryKey: ['billing'] })
			void queryClient.invalidateQueries({ queryKey: ['usage'] })
			params.delete('checkout')
			const qs = params.toString()
			history.replaceState(
				null,
				'',
				`${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
			)
		}
	})()
})

const sessionStore = authClient.useSession()
const user = $derived(
	$sessionStore.data?.user as { name?: string; email?: string; role?: string } | undefined
)
const displayName = $derived(user?.name || user?.email || '')
const isAdmin = $derived(user?.role === 'admin')

// Mail is an ADMIN-ONLY tab (the /api/inbox/* endpoints are server-gated to admins too). board 0060.
const tabs = $derived<{ id: Tab; label: string }[]>([
	{ id: 'chat', label: t('mainnet.nav.chat') },
	{ id: 'db', label: t('mainnet.nav.db') },
	{ id: 'draw', label: t('mainnet.nav.draw') },
	// board 0107 — Skills + Runs (the actor-model explorer) now live INSIDE the DB viewer as their own
	// categories (SKILLS = the flow template viewer + node/config aside; RUNS = the step trace, no graph),
	// so the top nav stays lean. Mail is the only remaining admin-only tab.
	...(isAdmin ? [{ id: 'mail' as Tab, label: 'Mail' }] : [])
])

function openTab(id: Tab): void {
	tab = id
	settings = false
	menuOpen = false
}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background">
	{#if justUpgraded}
		<div
			class="border-primary/30 bg-primary/10 text-foreground flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-sm"
			role="status"
		>
			<span class="font-semibold">{t('mainnet.pricing.upgradedTitle')}</span>
			<span class="text-muted-foreground min-w-0">{t('mainnet.pricing.upgradedBody')}</span>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground ml-auto shrink-0 text-xs font-semibold"
				onclick={() => (justUpgraded = false)}
				aria-label="Dismiss"
			>
				✕
			</button>
		</div>
	{/if}

	{#if settings}
		<AccountSettings category={settingsCategory} />
	{:else if tab === 'chat'}
		<MainnetChat />
	{:else if tab === 'draw'}
		<DrawCanvas />
	{:else if tab === 'mail'}
		<MailInbox />
	{:else}
		<MainnetDb />
	{/if}

	<!-- board 0119e — the section nav lives at the BOTTOM now (Samuel): content owns the top edge. -->
	<nav
		class="font-display pointer-events-none fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 px-4 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-[10px] font-bold tracking-wider uppercase"
		aria-label="Mainnet sections"
	>
		{#if isMobile}
			<!-- board 0120 — hamburger opens the left slide-menu (tabs live there on mobile). -->
			<button
				type="button"
				class="pointer-events-auto flex items-center gap-1.5 transition-opacity hover:opacity-80"
				onclick={() => (menuOpen = true)}
				aria-label="Open menu"
				aria-expanded={menuOpen}
			>
				<svg
					class="size-4"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					viewBox="0 0 24 24"
					aria-hidden="true"
				>
					<path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
				</svg>
				<span class="opacity-95"
					>{(settings ? t('selfNav.self') : tabs.find((x) => x.id === tab)?.label ?? '').toUpperCase()}</span
				>
			</button>
		{:else}
			{#each tabs as item, i (item.id)}
				{#if i > 0}
					<span class="select-none opacity-25" aria-hidden="true">|</span>
				{/if}
				<button
					type="button"
					class="pointer-events-auto transition-opacity hover:opacity-80 {tab === item.id && !settings
						? 'opacity-95'
						: 'opacity-40'}"
					aria-current={tab === item.id && !settings ? 'page' : undefined}
					onclick={() => openTab(item.id)}
				>
					{item.label.toUpperCase()}
				</button>
			{/each}
		{/if}

		<div class="ml-auto flex items-center gap-3">
			{#if usageQuery.data?.credit}
				<span class="tabular-nums opacity-60" title={t('mainnet.chat.credits')}>
					{fmtMinds(usageQuery.data.credit.remainingUsd)} {t('mainnet.chat.creditsLeft')}
				</span>
			{/if}
			{#if displayName}
				<button
					type="button"
					class="pointer-events-auto max-w-[14rem] truncate normal-case transition-opacity hover:opacity-80 {settings
						? 'text-foreground opacity-95'
						: 'opacity-60'}"
					title={user?.email}
					aria-current={settings ? 'page' : undefined}
					onclick={() => (settings = !settings)}
				>
					{displayName}
				</button>
			{/if}
		</div>
	</nav>

	<!-- board 0120 — mobile left slide-menu: the section tabs + account, opened by the hamburger. -->
	{#if isMobile && menuOpen}
		<button
			type="button"
			class="fixed inset-0 z-40 bg-black/40"
			aria-label="Close menu"
			onclick={() => (menuOpen = false)}
			transition:fade={{ duration: 150 }}
		></button>
		<aside
			class="bg-background fixed inset-y-0 left-0 z-50 flex w-64 max-w-[80vw] flex-col gap-1 border-r border-border p-4 pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl"
			transition:fly={{ x: -288, duration: 200 }}
		>
			<div class="mb-2 flex items-center justify-between">
				<span class="font-display text-[11px] font-bold tracking-[0.14em] uppercase opacity-50">
					{t('mainnet.chat.title')}
				</span>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground -m-1 p-1"
					aria-label="Close menu"
					onclick={() => (menuOpen = false)}
				>
					<svg
						class="size-5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
					</svg>
				</button>
			</div>
			{#each tabs as item (item.id)}
				<button
					type="button"
					class="font-display rounded-[var(--radius)] px-3 py-2.5 text-left text-sm font-bold tracking-wider uppercase transition-colors {tab ===
						item.id && !settings
						? 'bg-primary/10 text-foreground'
						: 'text-muted-foreground hover:bg-card'}"
					aria-current={tab === item.id && !settings ? 'page' : undefined}
					onclick={() => openTab(item.id)}
				>
					{item.label}
				</button>
			{/each}
			{#if displayName}
				<button
					type="button"
					class="mt-auto truncate rounded-[var(--radius)] px-3 py-2.5 text-left text-sm transition-colors {settings
						? 'bg-primary/10 text-foreground'
						: 'text-muted-foreground hover:bg-card'}"
					title={user?.email}
					onclick={() => {
						settings = true
						menuOpen = false
					}}
				>
					{displayName}
				</button>
			{/if}
		</aside>
	{/if}
</div>
