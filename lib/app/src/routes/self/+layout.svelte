<script lang="ts">
	import { page } from '$app/state'
	import { pickVaultRowForIdentity } from '$lib/self/active-vault-ui'
	import { deviceSession } from '$lib/self/device-session-store'
	import { provideSelfContext } from '$lib/self/self-context.svelte'
	import { vaultCardTitle, vaultList, type VaultListEntry } from '$lib/self/vault'
	import { browser } from '$app/environment'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { isIosHostedTauriShell } from '$lib/tauri/tauri-shell-platform'

	let { children } = $props()

	const ctx = provideSelfContext()
	const sessionKind = $derived($deviceSession.kind)

	let vaults = $state<VaultListEntry[]>([])

	const path = $derived(page.url.pathname)

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
		if (!v) return 'Self'
		return vaultCardTitle(v)
	})

	const profileDevice = $derived(activeVault?.deviceLabel?.trim() ?? '')

	const peersHiddenMobile = $derived(
		browser && isTauriRuntime() && isIosHostedTauriShell(),
	)

	const navSectionsAll: {
		title: string
		items: { href: string; label: string; match: (p: string) => boolean }[]
	}[] = [
		{
			title: 'Identities',
			items: [
				{ href: '/self', label: 'Self', match: (p) => p === '/self' || p === '/self/' },
				{
					href: '/self/peers',
					label: 'Peers',
					match: (p) => p.startsWith('/self/peers'),
				},
			],
		},
		{
			title: 'Sparks',
			items: [
				{
					href: '/self/workspaces',
					label: 'Share',
					match: (p) => p.startsWith('/self/workspaces'),
				},
			],
		},
		{
			title: 'Advanced',
			items: [
				{
					href: '/self/advanced/network',
					label: 'Network',
					match: (p) => p.startsWith('/self/advanced/network'),
				},
				{ href: '/self/db', label: 'DB', match: (p) => p.startsWith('/self/db') },
			],
		},
	]

	const navSections = $derived.by(() => {
		if (!peersHiddenMobile) return navSectionsAll
		return navSectionsAll.map((section) => ({
			...section,
			items: section.items.filter((tab) => tab.href !== '/self/peers'),
		}))
	})
</script>

<div class="grid h-full min-h-0 w-full grid-cols-[14rem_1fr]">
	<aside
		class="flex min-h-0 flex-col border-r border-border/60 bg-card/20 px-3 pt-1 pb-6"
		aria-label="Self settings"
	>
		<div class="mb-3 space-y-0.5 px-3">
			<h2 class="text-sm font-semibold tracking-tight">{profileName}</h2>
			{#if profileDevice}
				<p class="text-muted-foreground/70 text-xs leading-snug">{profileDevice}</p>
			{/if}
		</div>

		<nav class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
			{#each navSections as section (section.title)}
				<div class="flex flex-col gap-0.5">
					<p
						class="text-muted-foreground/70 mb-1 px-3 text-[9px] font-bold tracking-[0.2em] uppercase"
					>
						{section.title}
					</p>
					{#each section.items as tab (tab.href)}
						{@const active = tab.match(path)}
						<a
							href={tab.href}
							data-sveltekit-preload-data="hover"
							class="rounded-md px-3 py-1.5 text-[13px] transition-colors
								{active
								? 'bg-accent/15 text-foreground font-medium'
								: 'text-muted-foreground/70 hover:bg-accent/10 hover:text-foreground'}"
							aria-current={active ? 'page' : undefined}
						>
							{tab.label}
						</a>
					{/each}
				</div>
			{/each}
		</nav>
	</aside>

	<main class="min-h-0 overflow-y-auto">
		<div class="mx-auto w-full max-w-3xl px-6 pt-4 pb-8 sm:px-8">
			{@render children()}
		</div>
	</main>
</div>
