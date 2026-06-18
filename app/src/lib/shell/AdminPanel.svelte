<script lang="ts">
import { authClient } from '$lib/auth/auth-client'
import { t } from '$lib/i18n'

// Admin-only overlay: READ-ONLY list of all users + their role. Roles are changed
// SOLELY by flipping the `role` column in the Neon DB (Tables UI / SQL editor) — not
// from the app — so admin can't be minted in-app. The list endpoint (Better Auth admin
// plugin) is server-gated to admins; a non-admin can't reach it. board 0052.
let { onClose }: { onClose: () => void } = $props()

type AdminUser = { id: string; email: string; role?: string | null }

let users = $state<AdminUser[]>([])
let loading = $state(true)
let error = $state<string | null>(null)

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
						<span
							class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider {u.role ===
							'admin'
								? 'bg-primary/15 text-primary'
								: 'bg-muted text-muted-foreground'}"
						>
							{u.role ?? 'user'}
						</span>
					</div>
				{/each}
				<p class="text-muted-foreground px-3 pt-2 text-[11px] leading-relaxed">
					{t('mainnet.chat.adminRolesHint')}
				</p>
			{/if}
		</div>
	</div>
</div>
