<script lang="ts">
import { authClient, setBearerToken } from '$lib/auth/auth-client'
import { t } from '$lib/i18n'
import { clearNetwork } from '$lib/settings/network-store'
import AdminPanel from '$lib/shell/AdminPanel.svelte'
import MainnetChat from '$lib/shell/MainnetChat.svelte'
import MainnetVibes from '$lib/shell/MainnetVibes.svelte'

// Mainnet (Alberobello) shell: ONE top nav bar — Chat | Vibes on the left, Admin / Log out
// on the right (same line + style) — over the active view. board 0054.
let tab = $state<'chat' | 'vibes'>('chat')

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
		<button
			type="button"
			class="transition-opacity hover:opacity-80 {tab === 'chat' ? 'opacity-95' : 'opacity-40'}"
			aria-current={tab === 'chat' ? 'page' : undefined}
			onclick={() => (tab = 'chat')}
		>
			{t('mainnet.nav.chat')}
		</button>
		<span class="select-none opacity-25" aria-hidden="true">|</span>
		<button
			type="button"
			class="transition-opacity hover:opacity-80 {tab === 'vibes' ? 'opacity-95' : 'opacity-40'}"
			aria-current={tab === 'vibes' ? 'page' : undefined}
			onclick={() => (tab = 'vibes')}
		>
			{t('mainnet.nav.vibes')}
		</button>

		<div class="ml-auto flex items-center gap-3">
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
	{:else}
		<MainnetVibes />
	{/if}
</div>
