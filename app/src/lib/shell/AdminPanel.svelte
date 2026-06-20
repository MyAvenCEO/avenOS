<script lang="ts">
import { authClient, getBearerToken } from '$lib/auth/auth-client'
import { t } from '$lib/i18n'

const AI_BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

// Admin-only view (a normal in-place screen, reached from the left nav): list all users and
// grant/revoke roles + tiers. The GENESIS (first) admin is auto-assigned to the first signup;
// from there an admin manages everyone else here (Better Auth admin plugin, server-gated to
// admins; a non-admin can't reach these endpoints). board 0052.
type AdminUser = { id: string; email: string; role?: string | null; tier?: string | null }

let users = $state<AdminUser[]>([])
let loading = $state(true)
let error = $state<string | null>(null)
let pendingId = $state<string | null>(null)

async function load(): Promise<void> {
	loading = true
	error = null
	try {
		const res = await authClient.admin.listUsers({ query: { limit: 100 } })
		if (res.error) throw new Error(res.error.message ?? 'failed')
		users = (res.data?.users ?? []) as AdminUser[]
	} catch (e) {
		error = e instanceof Error ? e.message : String(e)
	} finally {
		loading = false
	}
}

// Flip a user between admin and user.
async function toggleRole(u: AdminUser): Promise<void> {
	if (pendingId) return
	pendingId = u.id
	error = null
	try {
		const role = u.role === 'admin' ? 'user' : 'admin'
		const res = await authClient.admin.setRole({ userId: u.id, role })
		if (res.error) error = res.error.message ?? 'failed'
		else await load()
	} finally {
		pendingId = null
	}
}

// Flip a user's comp tier (free <-> early-bird, the 10-MINDS early-adopter grant) via the
// admin-gated endpoint. board 0055.
async function toggleTier(u: AdminUser): Promise<void> {
	if (pendingId || !AI_BASE) return
	pendingId = u.id
	error = null
	try {
		const tier = u.tier === 'early-bird' ? 'free' : 'early-bird'
		const token = getBearerToken()
		const res = await fetch(`${AI_BASE}/api/admin/set-tier`, {
			method: 'POST',
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {})
			},
			body: JSON.stringify({ userId: u.id, tier })
		})
		if (!res.ok) error = `set-tier failed (HTTP ${res.status})`
		else await load()
	} finally {
		pendingId = null
	}
}

$effect(() => {
	void load()
})
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
	<div class="mx-auto flex w-full max-w-2xl flex-col">
		<h2 class="text-foreground mb-3 text-base font-semibold">{t('mainnet.chat.adminTitle')}</h2>
		{#if loading}
			<p class="text-muted-foreground p-3 text-sm">{t('mainnet.chat.adminLoading')}</p>
		{:else if error}
			<p class="text-destructive p-3 text-sm">{error}</p>
		{:else if users.length === 0}
			<p class="text-muted-foreground p-3 text-sm">{t('mainnet.chat.adminEmpty')}</p>
		{:else}
			<div
				class="border-border divide-border/60 divide-y overflow-hidden rounded-[var(--radius-lg)] border"
			>
				{#each users as u (u.id)}
					<div class="flex items-center justify-between gap-2 px-3 py-2.5">
						<div class="min-w-0 truncate text-sm font-medium">{u.email}</div>
						<div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
							<span
								class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {u.role ===
								'admin'
									? 'bg-primary/15 text-primary'
									: 'bg-muted text-muted-foreground'}"
							>
								{u.role ?? 'user'}
							</span>
							<button
								type="button"
								class="border-border hover:bg-card rounded-[var(--radius)] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40"
								onclick={() => void toggleRole(u)}
								disabled={pendingId !== null}
							>
								{u.role === 'admin' ? t('mainnet.chat.adminRevoke') : t('mainnet.chat.adminGrant')}
							</button>
							<span
								class="ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {u.tier ===
								'early-bird'
									? 'bg-primary/15 text-primary'
									: 'bg-muted text-muted-foreground'}"
							>
								{u.tier ?? 'free'}
							</span>
							<button
								type="button"
								class="border-border hover:bg-card rounded-[var(--radius)] border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
								onclick={() => void toggleTier(u)}
								disabled={pendingId !== null}
							>
								→ {u.tier === 'early-bird' ? 'free' : 'early-bird'}
							</button>
						</div>
					</div>
				{/each}
			</div>
			<p class="text-muted-foreground px-1 pt-3 text-[11px] leading-relaxed">
				{t('mainnet.chat.adminRolesHint')}
			</p>
		{/if}
	</div>
</div>
