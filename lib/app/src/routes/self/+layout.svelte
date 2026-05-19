<script lang="ts">
	import { page } from '$app/state'
	import { deviceSession } from '$lib/self/device-session-store'
	import { provideSelfContext } from '$lib/self/self-context.svelte'
	import { vaultCardTitle, vaultList, vaultSelectedSlug, type VaultListEntry } from '$lib/self/vault'
	import { browser } from '$app/environment'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'

	let { children } = $props()

	const ctx = provideSelfContext()
	const sessionKind = $derived($deviceSession.kind)

	let vaults = $state<VaultListEntry[]>([])
	let activeSlug = $state<string | undefined>(undefined)

	$effect(() => {
		void sessionKind
		void ctx.refresh()
	})

	$effect(() => {
		if (!browser || !isTauriRuntime()) return
		void sessionKind
		void (async () => {
			try {
				vaults = await vaultList()
				activeSlug = await vaultSelectedSlug()
			} catch {
				vaults = []
				activeSlug = undefined
			}
		})()
	})

	const path = $derived(page.url.pathname)

	const activeVault = $derived.by(() => {
		if (activeSlug) {
			const m = vaults.find((v) => v.usernameSlug === activeSlug)
			if (m) return m
		}
		return vaults[0]
	})

	const profileLine = $derived.by(() => {
		const v = activeVault
		if (!v) return 'Self'
		const name = vaultCardTitle(v)
		const dev = v.deviceLabel?.trim()
		if (dev) return `${name} · ${dev}`
		return name
	})

	const navSections: {
		title: string
		items: { href: string; label: string; match: (p: string) => boolean }[]
	}[] = [
		{
			title: 'You',
			items: [
				{ href: '/self', label: 'Profile & IDs', match: (p) => p === '/self' || p === '/self/' },
			],
		},
		{
			title: 'Devices',
			items: [
				{
					href: '/self/network',
					label: 'Connect & trust',
					match: (p) => p.startsWith('/self/network'),
				},
			],
		},
		{
			title: 'Sparks',
			items: [
				{
					href: '/self/workspaces',
					label: 'Workspace sharing',
					match: (p) => p.startsWith('/self/workspaces'),
				},
			],
		},
		{
			title: 'Advanced',
			items: [{ href: '/self/db', label: 'DB', match: (p) => p.startsWith('/self/db') }],
		},
	]

	const sessionLabel = $derived(sessionKind === 'unlocked' ? 'Unlocked' : 'Locked')
	const sessionDot = $derived(sessionKind === 'unlocked' ? 'bg-emerald-500' : 'bg-zinc-400')
</script>

<div class="grid h-full min-h-0 w-full grid-cols-[14rem_1fr]">
	<aside
		class="flex min-h-0 flex-col border-r border-border/60 bg-card/20 px-3 py-6"
		aria-label="Self settings"
	>
		<div class="mb-4 px-3">
			<h2 class="text-sm font-semibold tracking-tight">{profileLine}</h2>
			<p class="text-muted-foreground text-[11px] leading-snug">
				You, your devices, and how sparks sync
			</p>
		</div>

		<nav class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
			{#each navSections as section (section.title)}
				<div class="flex flex-col gap-0.5">
					<p class="text-muted-foreground mb-1 px-3 text-[9px] font-bold tracking-[0.2em] uppercase">
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
								: 'text-muted-foreground hover:bg-accent/10 hover:text-foreground'}"
							aria-current={active ? 'page' : undefined}
						>
							{tab.label}
						</a>
					{/each}
				</div>
			{/each}
		</nav>

		<div class="mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-[11px]">
			<span class="inline-flex h-2 w-2 rounded-full {sessionDot}" aria-hidden="true"></span>
			<span class="text-muted-foreground">{sessionLabel}</span>
		</div>
	</aside>

	<main class="min-h-0 overflow-y-auto">
		<div class="mx-auto w-full max-w-3xl px-6 py-8 sm:px-8">
			{@render children()}
		</div>
	</main>
</div>
