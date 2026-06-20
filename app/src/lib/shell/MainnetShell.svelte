<script lang="ts">
import { createQuery, useQueryClient } from '@tanstack/svelte-query'
import { authClient, setBearerToken } from '$lib/auth/auth-client'
import { syncBilling } from '$lib/billing/checkout'
import { fmtMinds } from '$lib/billing/minds'
import DebugCopy from '$lib/debug/DebugCopy.svelte'
import { t } from '$lib/i18n'
import { qk } from '$lib/query/client'
import { fetchUsage } from '$lib/query/usage'
import { clearNetwork } from '$lib/settings/network-store'
import AdminPanel from '$lib/shell/AdminPanel.svelte'
import MainnetChat from '$lib/shell/MainnetChat.svelte'
import MainnetDb from '$lib/shell/MainnetDb.svelte'
import MainnetVibes from '$lib/shell/MainnetVibes.svelte'
import PricingPanel from '$lib/shell/PricingPanel.svelte'

// Mainnet (Alberobello) shell: ONE top nav bar — Chat | Vibes | Schemas | DB (+ Admin for
// admins) on the left, weekly credits + signed-in identity + Log out on the right — over the
// active view. Every section (incl. Admin) is a normal in-place view, not a modal. board 0053/0054.
type Tab = 'chat' | 'vibes' | 'db' | 'plan' | 'admin'
let tab = $state<Tab>('chat')
let checkoutHandled = false
// Shown briefly after returning from a successful Polar checkout (?checkout=success).
let justUpgraded = $state(false)

// Weekly credit (MINDS) for the nav — live via TanStack Query; the SSE 'usage'/'billing'
// events invalidate it, so no manual refresh. board 0055.
const queryClient = useQueryClient()
const usageQuery = createQuery(() => ({ queryKey: qk.usage, queryFn: fetchUsage }))

$effect(() => {
	if (checkoutHandled) return
	checkoutHandled = true
	void (async () => {
		// Returned from Polar checkout? Reconcile the entitlement so the new plan + weekly MINDS
		// appear at once (no wait on a webhook), land on the Plan tab, and clear the flag so a
		// reload doesn't re-trigger.
		const params = new URLSearchParams(window.location.search)
		if (params.get('checkout') === 'success') {
			tab = 'plan'
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
const isAdmin = $derived(user?.role === 'admin')
const displayName = $derived(user?.name || user?.email || '')

// Left-nav tabs; Admin only shows for admins (and is the only tab they can leave for/return to).
const tabs = $derived<{ id: Tab; label: string }[]>([
	{ id: 'chat', label: t('mainnet.nav.chat') },
	{ id: 'vibes', label: t('mainnet.nav.vibes') },
	{ id: 'db', label: t('mainnet.nav.db') },
	{ id: 'plan', label: t('mainnet.nav.plan') },
	...(isAdmin ? [{ id: 'admin' as Tab, label: t('mainnet.nav.admin') }] : [])
])

// Sign out of Better Auth (best-effort), drop the bearer token, and forget the network
// choice so the app returns to the Select Network intro.
async function logout(): Promise<void> {
	try {
		await authClient.signOut()
	} catch {
		/* sign out locally regardless of a network error */
	}
	setBearerToken(null)
	clearNetwork()
}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background">
	<nav
		class="flex shrink-0 items-center gap-2 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1.5 text-[10px] font-bold tracking-wider uppercase"
		aria-label="Mainnet sections"
	>
		{#each tabs as item, i (item.id)}
			{#if i > 0}
				<span class="select-none opacity-25" aria-hidden="true">|</span>
			{/if}
			<button
				type="button"
				class="transition-opacity hover:opacity-80 {tab === item.id ? 'opacity-95' : 'opacity-40'}"
				aria-current={tab === item.id ? 'page' : undefined}
				onclick={() => (tab = item.id)}
			>
				{item.label}
			</button>
		{/each}

		<div class="ml-auto flex items-center gap-3">
			{#if usageQuery.data?.credit}
				<span class="tabular-nums opacity-60" title={t('mainnet.chat.credits')}>
					{fmtMinds(usageQuery.data.credit.remainingUsd)} {t('mainnet.chat.creditsLeft')}
				</span>
			{/if}
			{#if displayName}
				<span class="max-w-[14rem] truncate normal-case opacity-60" title={user?.email}>
					{displayName}
				</span>
			{/if}
			<button
				type="button"
				class="transition-opacity hover:opacity-80 opacity-40"
				onclick={() => void logout()}
			>
				{t('mainnet.chat.logout')}
			</button>
			<span class="normal-case opacity-50"><DebugCopy compact /></span>
		</div>
	</nav>

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

	{#if tab === 'chat'}
		<MainnetChat />
	{:else if tab === 'vibes'}
		<MainnetVibes />
	{:else if tab === 'plan'}
		<PricingPanel />
	{:else if tab === 'admin' && isAdmin}
		<AdminPanel />
	{:else}
		<MainnetDb />
	{/if}
</div>
