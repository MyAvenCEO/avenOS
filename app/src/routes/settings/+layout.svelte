<script lang="ts">
import { browser } from '$app/environment'
import { page } from '$app/state'
import { t } from '$lib/i18n'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { clearSessionToken } from '$lib/self/network-auth'
import { pickVaultRowForIdentity } from '$lib/settings/active-vault-ui'
import { clearDeviceSession, deviceSession } from '$lib/settings/device-session-store'
import { provideSelfContext } from '$lib/settings/self-context.svelte'
import { type VaultListEntry, vaultCardTitle, vaultList } from '$lib/settings/vault'
import { settingsNavSections } from '$lib/shell/settings-nav'
import AsidePageLayout from '$lib/ui/AsidePageLayout.svelte'
import { asideNavSectionsFromRoutes } from '$lib/ui/aside-nav'

let { children: pageOutlet } = $props()

const ctx = provideSelfContext()
const sessionKind = $derived($deviceSession.kind)

let vaults = $state<VaultListEntry[]>([])

const path = $derived(page.url.pathname)

const navSections = $derived(asideNavSectionsFromRoutes(settingsNavSections(), path))

$effect(() => {
	void sessionKind
	void ctx.refresh()
})

$effect(() => {
	if (!browser || !isTauriRuntime()) return
	void sessionKind
	void $deviceSession
	void (async () => {
		try {
			vaults = await vaultList()
		} catch {
			vaults = []
		}
	})()
})

const activeVault = $derived.by(() => {
	if ($deviceSession.kind === 'locked') return undefined
	return pickVaultRowForIdentity(vaults, $deviceSession)
})

const profileName = $derived.by(() => {
	const v = activeVault
	if (!v) return t('nav.self')
	return vaultCardTitle(v)
})

const profileDevice = $derived(activeVault?.deviceLabel?.trim() ?? '')

/** Lock the identity (back to the picker) and drop the auth-server session — lets you switch
 * accounts within one app run for testing. */
async function logout(): Promise<void> {
	clearSessionToken()
	await clearDeviceSession()
}
</script>

<AsidePageLayout asideLabel={t('nav.selfSettings')} sections={navSections} muted routeKey={path}>
	{#snippet header()}
		<div class="mb-3 space-y-0.5 px-3">
			<h2 class="text-sm font-semibold tracking-tight">{profileName}</h2>
			{#if profileDevice}
				<p class="text-muted-foreground/70 text-xs leading-snug">{profileDevice}</p>
			{/if}
		</div>
	{/snippet}

	{#snippet asideExtra()}
		<div class="mt-3 border-t px-3 pt-3">
			<button
				type="button"
				onclick={() => void logout()}
				class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-xs font-medium transition-colors"
			>
				<svg
					viewBox="0 0 24 24"
					class="size-4 shrink-0"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
					<polyline points="16 17 21 12 16 7" />
					<line x1="21" y1="12" x2="9" y2="12" />
				</svg>
				{t('selfNav.logout')}
			</button>
		</div>
	{/snippet}

	{#snippet children()}
		{@render pageOutlet()}
	{/snippet}
</AsidePageLayout>
