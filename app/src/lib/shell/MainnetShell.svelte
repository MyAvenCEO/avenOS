<script lang="ts">
import { authClient, setBearerToken } from '$lib/auth/auth-client'
import { fmtMinds } from '$lib/billing/minds'
import { refreshUsage, usage } from '$lib/data/usage-store'
import DebugCopy from '$lib/debug/DebugCopy.svelte'
import { t } from '$lib/i18n'
import { clearNetwork } from '$lib/settings/network-store'
import AdminPanel from '$lib/shell/AdminPanel.svelte'
import MainnetChat from '$lib/shell/MainnetChat.svelte'
import MainnetDb from '$lib/shell/MainnetDb.svelte'
import MainnetSchemas from '$lib/shell/MainnetSchemas.svelte'
import MainnetVibes from '$lib/shell/MainnetVibes.svelte'

// Mainnet (Alberobello) shell: ONE top nav bar — Chat | Vibes | Schemas | DB (+ Admin for
// admins) on the left, weekly credits + signed-in identity + Log out on the right — over the
// active view. Every section (incl. Admin) is a normal in-place view, not a modal. board 0053/0054.
type Tab = 'chat' | 'vibes' | 'schemas' | 'db' | 'admin'
let tab = $state<Tab>('chat')
let usageStarted = false

$effect(() => {
	if (usageStarted) return
	usageStarted = true
	void refreshUsage()
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
	{ id: 'schemas', label: t('mainnet.nav.schemas') },
	{ id: 'db', label: t('mainnet.nav.db') },
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
			{#if $usage?.credit}
				<span class="tabular-nums opacity-60" title={t('mainnet.chat.credits')}>
					{fmtMinds($usage.credit.remainingUsd)} {t('mainnet.chat.creditsLeft')}
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

	{#if tab === 'chat'}
		<MainnetChat />
	{:else if tab === 'vibes'}
		<MainnetVibes />
	{:else if tab === 'schemas'}
		<MainnetSchemas />
	{:else if tab === 'admin' && isAdmin}
		<AdminPanel />
	{:else}
		<MainnetDb />
	{/if}
</div>
