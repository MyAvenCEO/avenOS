<script lang="ts">
import { authClient, setBearerToken } from '$lib/auth/auth-client'
import { clearNetwork } from '$lib/settings/network-store'
import AdminPanel from '$lib/shell/AdminPanel.svelte'
import PricingPanel from '$lib/shell/PricingPanel.svelte'
import UsageStats from '$lib/shell/UsageStats.svelte'
import VaultKeys from '$lib/shell/VaultKeys.svelte'

// Account settings (board 0055): opened from the account name in the top nav. Left aside selects
// a category (Profile | Plans | Billing | Usage | Vault keys | Admin for admins); main center
// renders it. Log out is pinned to the bottom of the aside.
type Category = 'profile' | 'plans' | 'billing' | 'usage' | 'vault' | 'admin'
let { category = 'profile' }: { category?: Category } = $props()
// `category` is read once as the initial tab; the parent remounts this on open, so a fresh value
// always arrives. Local navigation owns `active` after that.
// svelte-ignore state_referenced_locally
let active = $state<Category>(category)

const sessionStore = authClient.useSession()
const user = $derived(
	$sessionStore.data?.user as { name?: string; email?: string; role?: string } | undefined
)
const isAdmin = $derived(user?.role === 'admin')

// Admin only shows for admins (the AdminPanel endpoints are server-gated to admins too).
const cats = $derived<{ id: Category; label: string }[]>([
	{ id: 'profile', label: 'Profile' },
	{ id: 'plans', label: 'Plans' },
	{ id: 'billing', label: 'Billing' },
	{ id: 'usage', label: 'Usage' },
	{ id: 'vault', label: 'Vault keys' },
	...(isAdmin ? [{ id: 'admin' as Category, label: 'Admin' }] : [])
])

// Sign out of Better Auth (best-effort), drop the bearer token, forget the network choice so the
// app returns to the Select Network intro.
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

<div class="flex min-h-0 flex-1">
	<!-- Left: category select; Log out pinned to the bottom -->
	<aside class="border-border flex w-56 shrink-0 flex-col border-r pt-3">
		<p class="text-muted-foreground px-3 pb-2 text-[10px] font-bold tracking-[0.14em] uppercase">
			Account
		</p>
		<nav class="flex min-h-0 flex-1 flex-col gap-0.5 px-2">
			{#each cats as c (c.id)}
				<button
					type="button"
					class="rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px] transition-colors {active ===
					c.id
						? 'bg-primary/10 text-foreground font-medium'
						: 'text-muted-foreground hover:bg-card'}"
					onclick={() => (active = c.id)}
				>
					{c.label}
				</button>
			{/each}
		</nav>
		<button
			type="button"
			class="text-muted-foreground hover:bg-card hover:text-foreground m-2 rounded-[var(--radius)] px-2.5 py-1.5 text-left text-[13px]"
			onclick={() => void logout()}
		>
			Log out
		</button>
	</aside>

	<!-- Right: the selected category -->
	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
		{#if active === 'profile'}
			<div class="mx-auto flex w-full max-w-xl flex-col gap-4 p-6">
				<h2 class="text-foreground text-base font-semibold">Profile</h2>
				<div class="flex flex-col gap-3">
					<div class="flex flex-col gap-0.5">
						<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
							Name
						</span>
						<span class="text-foreground text-[14px]">{user?.name ?? '—'}</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
							Email (Google)
						</span>
						<span class="text-foreground text-[14px]">{user?.email ?? '—'}</span>
					</div>
					<div class="flex flex-col gap-0.5">
						<span class="text-muted-foreground text-[11px] font-bold tracking-wider uppercase">
							Role
						</span>
						<span class="text-foreground text-[14px]">{user?.role ?? 'user'}</span>
					</div>
				</div>
			</div>
		{:else if active === 'plans'}
			<PricingPanel section="plans" />
		{:else if active === 'billing'}
			<PricingPanel section="billing" />
		{:else if active === 'usage'}
			<UsageStats />
		{:else if active === 'admin' && isAdmin}
			<AdminPanel />
		{:else}
			<VaultKeys />
		{/if}
	</div>
</div>
