<script lang="ts">
import { authClient, getBearerToken } from '$lib/auth/auth-client'
import { t } from '$lib/i18n'

const AI_BASE = import.meta.env.PUBLIC_BETTER_AUTH_URL as string | undefined

// Admin-only overlay: list all users and grant/revoke roles. The GENESIS (first) admin
// is set solely by flipping `role` in the Neon DB — no hardcoded admin. From there, an
// admin manages everyone else's role here (Better Auth admin plugin, server-gated to
// admins; a non-admin can't reach these endpoints). board 0052.
let { onClose }: { onClose: () => void } = $props()

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

// Flip a user's product tier (free <-> avenCITY) via the admin-gated endpoint.
async function toggleTier(u: AdminUser): Promise<void> {
	if (pendingId || !AI_BASE) return
	pendingId = u.id
	error = null
	try {
		const tier = u.tier === 'avenCITY' ? 'free' : 'avenCITY'
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

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
	role="dialog"
	aria-modal="true"
>
	<div
		class="border-border bg-card flex max-h-[80vh] w-full max-w-md flex-col rounded-[var(--radius-lg)] border"
	>
		<div class="border-border flex items-center justify-between border-b px-4 py-3">
			<h2 class="font-display text-base font-medium">{t('mainnet.chat.adminTitle')}</h2>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground text-xs font-semibold"
				onclick={onClose}
			>
				{t('mainnet.chat.adminClose')}
			</button>
		</div>
		<div class="min-h-0 flex-1 overflow-y-auto p-2">
			{#if loading}
				<p class="text-muted-foreground p-3 text-sm">{t('mainnet.chat.adminLoading')}</p>
			{:else if error}
				<p class="text-destructive p-3 text-sm">{error}</p>
			{:else if users.length === 0}
				<p class="text-muted-foreground p-3 text-sm">{t('mainnet.chat.adminEmpty')}</p>
			{:else}
				{#each users as u (u.id)}
					<div class="flex items-center justify-between gap-2 rounded-[var(--radius)] px-3 py-2">
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
								class="border-border hover:bg-background rounded-[var(--radius)] border px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-40"
								onclick={() => void toggleRole(u)}
								disabled={pendingId !== null}
							>
								{u.role === 'admin' ? t('mainnet.chat.adminRevoke') : t('mainnet.chat.adminGrant')}
							</button>
							<span
								class="ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {u.tier ===
								'avenCITY'
									? 'bg-primary/15 text-primary'
									: 'bg-muted text-muted-foreground'}"
							>
								{u.tier ?? 'free'}
							</span>
							<button
								type="button"
								class="border-border hover:bg-background rounded-[var(--radius)] border px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-40"
								onclick={() => void toggleTier(u)}
								disabled={pendingId !== null}
							>
								→ {u.tier === 'avenCITY' ? 'free' : 'avenCITY'}
							</button>
						</div>
					</div>
				{/each}
				<p class="text-muted-foreground px-3 pt-2 text-[11px] leading-relaxed">
					{t('mainnet.chat.adminRolesHint')}
				</p>
			{/if}
		</div>
	</div>
</div>
