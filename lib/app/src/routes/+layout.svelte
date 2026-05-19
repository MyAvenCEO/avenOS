<script lang="ts">
import { page } from '$app/state'
import { browser } from '$app/environment'
import { ensureComposerTauriShortcutBridge } from '$lib/intent-mock/composer-tauri-bridge'
import P2pSyncBadge from '$lib/peer/P2pSyncBadge.svelte'
import LockGate from '$lib/self/LockGate.svelte'
import { deviceSession } from '$lib/self/device-session-store'
import { vaultCardTitle, vaultList, vaultSelectedSlug, type VaultListEntry } from '$lib/self/vault'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import '../app.css'

let { children: pageContent } = $props()

$effect(() => {
	ensureComposerTauriShortcutBridge()
})

const path = $derived(page.url.pathname)
const intentsActive = $derived(path === '/')
const sandboxActive = $derived(path.startsWith('/sandbox'))
const docsActive = $derived(path.startsWith('/docs'))
const selfActive = $derived(path.startsWith('/self'))
const sparksNavActive = $derived(path.startsWith('/sparks'))
const dbActive = $derived(path.startsWith('/db'))

const shellLocked = $derived(
	browser && isTauriRuntime() && $deviceSession.kind === 'locked',
)

const sessionKind = $derived($deviceSession.kind)

let vaults = $state<VaultListEntry[]>([])
let activeSlug = $state<string | undefined>(undefined)

$effect(() => {
	if (!browser || !isTauriRuntime() || sessionKind !== 'unlocked') return
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

const selfNavLabel = $derived.by(() => {
	if (activeSlug) {
		const match = vaults.find((v) => v.usernameSlug === activeSlug)
		if (match) return vaultCardTitle(match)
	}
	const first = vaults[0]
	if (first) return vaultCardTitle(first)
	return 'Self'
})
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml">
</svelte:head>

<div class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background">
	<LockGate />
	{#if !shellLocked}
		<header class="shrink-0 bg-background/90 px-4 pt-3 pb-2 backdrop-blur-sm sm:px-6">
			<div
				class="mx-auto grid w-full max-w-[min(100%,88rem)] grid-cols-3 items-center gap-x-2 gap-y-2"
			>
				<div class="flex min-w-0 items-center justify-start justify-self-start">
					<P2pSyncBadge />
				</div>

				<nav
					class="flex flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold tracking-wider uppercase"
					aria-label="App sections"
				>
					<a
						href="/"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {intentsActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={intentsActive ? 'page' : undefined}
						>Intents</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/sandbox"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sandboxActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sandboxActive ? 'page' : undefined}
						>Sandbox</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/sparks"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sparksNavActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sparksNavActive ? 'page' : undefined}
						>Sparks</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/db"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {dbActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={dbActive ? 'page' : undefined}
						>DB</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/docs"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {docsActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={docsActive ? 'page' : undefined}
						>Docs</a
					>
				</nav>

				<nav
					class="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 justify-self-end text-[10px] font-bold tracking-wider uppercase"
					aria-label="Device identity"
				>
					<a
						href="/self"
						data-sveltekit-preload-data="hover"
						class="normal-case max-w-[8rem] truncate text-[11px] font-semibold tracking-normal transition-opacity hover:opacity-80 sm:max-w-[10rem] {selfActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={selfActive ? 'page' : undefined}
						title={selfNavLabel}
						>{selfNavLabel}</a
					>
				</nav>
			</div>
		</header>
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{@render pageContent()}
		</div>
	{/if}
</div>
