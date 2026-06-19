<script lang="ts">
import { authClient, setBearerToken } from '$lib/auth/auth-client'
import { fmtMinds } from '$lib/billing/minds'
import { refreshUsage, usage } from '$lib/data/usage-store'
import { t } from '$lib/i18n'
import { clearNetwork } from '$lib/settings/network-store'
import AdminPanel from '$lib/shell/AdminPanel.svelte'
import MainnetChat from '$lib/shell/MainnetChat.svelte'
import MainnetDb from '$lib/shell/MainnetDb.svelte'
import MainnetSchemas from '$lib/shell/MainnetSchemas.svelte'
import MainnetVibes from '$lib/shell/MainnetVibes.svelte'

// Mainnet (Alberobello) shell: ONE top nav bar — Chat | Vibes | Schemas | DB on the left,
// weekly credits + Admin / Log out on the right (same line + style) — over the active view.
// board 0053/0054.
type Tab = 'chat' | 'vibes' | 'schemas' | 'db'
const TABS: { id: Tab; label: string }[] = [
	{ id: 'chat', label: t('mainnet.nav.chat') },
	{ id: 'vibes', label: t('mainnet.nav.vibes') },
	{ id: 'schemas', label: t('mainnet.nav.schemas') },
	{ id: 'db', label: t('mainnet.nav.db') }
]
let tab = $state<Tab>('chat')
let usageStarted = false

$effect(() => {
	if (usageStarted) return
	usageStarted = true
	void refreshUsage()
})

const sessionStore = authClient.useSession()
const isAdmin = $derived(
	($sessionStore.data?.user as { role?: string } | undefined)?.role === 'admin'
)
let adminOpen = $state(false)

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
		class="border-border flex shrink-0 items-center gap-2 border-b px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1.5 text-[10px] font-bold tracking-wider uppercase"
		aria-label="Mainnet sections"
	>
		{#each TABS as item, i (item.id)}
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
			{#if isAdmin}
				<button
					type="button"
					class="transition-opacity hover:opacity-80 opacity-40"
					onclick={() => (adminOpen = true)}
				>
					{t('mainnet.chat.adminButton')}
				</button>
			{/if}
			<button
				type="button"
				class="transition-opacity hover:opacity-80 opacity-40"
				onclick={() => void logout()}
			>
				{t('mainnet.chat.logout')}
			</button>
		</div>
	</nav>

	{#if adminOpen}
		<AdminPanel onClose={() => (adminOpen = false)} />
	{/if}

	{#if tab === 'chat'}
		<MainnetChat />
	{:else if tab === 'vibes'}
		<MainnetVibes />
	{:else if tab === 'schemas'}
		<MainnetSchemas />
	{:else}
		<MainnetDb />
	{/if}
</div>
