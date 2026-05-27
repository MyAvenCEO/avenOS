<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { browser } from '$app/environment'
import { ensureComposerTauriShortcutBridge } from '$lib/intent-mock/composer-tauri-bridge'
import { pendingIntentFileDrop } from '$lib/intents/global-file-drop'
import P2pSyncBadge from '$lib/peer/P2pSyncBadge.svelte'
import {
	attachAvenosRuntimeBridge,
	grooveSessionReady,
} from '$lib/runtime/groove-runtime'
import { startPeerMeshStore } from '$lib/peer/peer-mesh-store'
import LockGate from '$lib/self/LockGate.svelte'
import { attachSelfRustEventMirrors, deviceSession } from '$lib/self/device-session-store'
import { displayTitleForSession } from '$lib/self/active-vault-ui'
import { vaultCardTitle, vaultList, type VaultListEntry } from '$lib/self/vault'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import MobileShellNav from '$lib/shell/MobileShellNav.svelte'
import { navigateApp } from '$lib/shell'
import '../app.css'

let { children: pageContent } = $props()

$effect(() => {
	ensureComposerTauriShortcutBridge()
})

const path = $derived(page.url.pathname)
const routeKey = $derived(`${page.url.pathname}${page.url.search}`)
const intentsActive = $derived(path === '/')
const sandboxActive = $derived(path.startsWith('/sandbox'))
const docsActive = $derived(path.startsWith('/docs'))
const selfActive = $derived(path.startsWith('/self'))
const sparksNavActive = $derived(path.startsWith('/sparks'))
const dbActive = $derived(path.startsWith('/db'))

const shellLocked = $derived(
	browser && isTauriRuntime() && $deviceSession.kind === 'locked',
)

$effect(() => {
	if (shellLocked) pendingIntentFileDrop.set(null)
})

$effect(() => {
	if (!browser || !isTauriRuntime()) return () => {}
	return attachAvenosRuntimeBridge()
})

$effect(() => {
	if (!browser || !isTauriRuntime()) return () => {}
	return attachSelfRustEventMirrors()
})

const sessionKind = $derived($deviceSession.kind)

/** Mesh touches Groove ACL — defer until strict local-first bootstrap confirms shell hydrate. */
const meshAllowed = $derived(
	sessionKind === 'unlocked' && $grooveSessionReady,
)

$effect(() => {
	if (!browser || !isTauriRuntime() || !meshAllowed) return
	return startPeerMeshStore()
})

let vaults = $state<VaultListEntry[]>([])

$effect(() => {
	void sessionKind
	if (!browser || !isTauriRuntime() || sessionKind !== 'unlocked') return
	void (async () => {
		try {
			vaults = await vaultList()
		} catch {
			vaults = []
		}
	})()
})

const selfNavLabel = $derived.by(() => {
	const ds = $deviceSession
	const title =
		ds.kind === 'unlocked'
			? displayTitleForSession(vaults, ds)
			: vaults.length > 0
				? vaultCardTitle(vaults[0])
				: 'Self'
	return title
})

/** Global file-drag overlay (all routes when unlocked; not active on lock screen). */
let dragDepth = $state(0)
const dragActive = $derived(dragDepth > 0)

function isFilesDrag(dt: DataTransfer | null): boolean {
	if (!dt) return false
	return Array.from(dt.types).includes('Files')
}

$effect(() => {
	if (!browser || shellLocked) return
	const onDragEnter = (e: DragEvent) => {
		if (!isFilesDrag(e.dataTransfer)) return
		e.preventDefault()
		dragDepth += 1
	}
	const onDragLeave = (e: DragEvent) => {
		if (!isFilesDrag(e.dataTransfer)) return
		e.preventDefault()
		dragDepth = Math.max(0, dragDepth - 1)
	}
	const onDragOver = (e: DragEvent) => {
		const dt = e.dataTransfer
		if (!dt || !isFilesDrag(dt)) return
		e.preventDefault()
		dt.dropEffect = 'copy'
	}
	const resetDragOverlay = () => {
		dragDepth = 0
	}
	const onDrop = (e: DragEvent) => {
		if (!isFilesDrag(e.dataTransfer)) return
		e.preventDefault()
		resetDragOverlay()
		const list = e.dataTransfer?.files
		if (!list?.length) return
		const files = Array.from(list)
		pendingIntentFileDrop.set(files)
		if (page.url.pathname !== '/') {
			void goto('/')
		}
	}

	window.addEventListener('dragenter', onDragEnter)
	window.addEventListener('dragleave', onDragLeave)
	window.addEventListener('dragover', onDragOver)
	window.addEventListener('drop', onDrop)
	window.addEventListener('dragend', resetDragOverlay)

	return () => {
		window.removeEventListener('dragenter', onDragEnter)
		window.removeEventListener('dragleave', onDragLeave)
		window.removeEventListener('dragover', onDragOver)
		window.removeEventListener('drop', onDrop)
		window.removeEventListener('dragend', resetDragOverlay)
		resetDragOverlay()
	}
})
</script>

<svelte:head>
	<link rel="icon" href="/favicon.png" type="image/png" sizes="32x32">
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="128x128">
</svelte:head>

<div class="box-border flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-background">
	<LockGate />
	{#if !shellLocked}
		<header class="shrink-0 bg-background/90 px-3 pt-1.5 pb-1 backdrop-blur-sm sm:px-6 sm:pt-3 sm:pb-2">
			<div
				class="mx-auto grid w-full max-w-[min(100%,88rem)] grid-cols-1 items-center gap-x-2 gap-y-2 sm:grid-cols-3"
			>
				<div class="flex min-w-0 items-center justify-start justify-self-start sm:justify-self-start">
					<P2pSyncBadge />
				</div>

				<nav
					class="hidden flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold tracking-wider uppercase sm:flex"
					aria-label="App sections"
				>
					<a
						href="/"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {intentsActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={intentsActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/', e)}
						>Intents</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/sandbox"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sandboxActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sandboxActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/sandbox', e)}
						>Sandbox</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/sparks"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sparksNavActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sparksNavActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/sparks', e)}
						>Sparks</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/db"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {dbActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={dbActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/db', e)}
						>DB</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/docs"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {docsActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={docsActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/docs', e)}
						>Docs</a
					>
				</nav>

				<nav
					class="hidden min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 justify-self-end text-[10px] font-bold tracking-wider uppercase sm:flex"
					aria-label="Device identity"
				>
					<a
						href="/self/peers"
						data-sveltekit-preload-data="hover"
						class="normal-case max-w-[8rem] truncate text-[11px] font-semibold tracking-normal transition-opacity hover:opacity-80 sm:max-w-[10rem] {selfActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={selfActive ? 'page' : undefined}
						title={selfNavLabel}
						onclick={(e) => navigateApp('/self/peers', e)}
						>{selfNavLabel}</a
					>
				</nav>
			</div>
		</header>
		{#if dragActive}
			<div
				class="pointer-events-auto fixed inset-0 z-[100] flex touch-none items-center justify-center bg-background/95 backdrop-blur-md"
				role="region"
				aria-label="Drop files to attach in composer"
			>
				<div class="mx-6 w-full max-w-md">
					<div
						class="rounded-[var(--radius-lg)] border-[3px] border-dashed border-primary/50 bg-card/96 p-[10px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_14%,transparent)] ring-2 ring-primary/20 ring-offset-[8px] ring-offset-background backdrop-blur-sm"
					>
						<div
							class="rounded-[calc(var(--radius-lg)-8px)] border border-dotted border-primary/40 bg-muted/40 px-7 py-9 text-center"
						>
							<p class="text-xl font-semibold tracking-tight text-primary md:text-[1.3rem]">
								Drop files here
							</p>
							<p class="mt-2.5 px-1 text-[12px] leading-relaxed opacity-85">
								Release to open Intents with thumbnails and optional message.
							</p>
							<p class="mt-1.5 px-1 text-[11px] leading-relaxed opacity-55">
								PDF, JPEG, PNG, or SVG — on submit, allowed files sync to your local Groove
								<code class="font-mono text-[10px]">files</code> table (unlock required).
							</p>
						</div>
					</div>
				</div>
			</div>
		{/if}
		<div
			class={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden${dragActive ? ' pointer-events-none select-none saturate-75 contrast-[0.85] brightness-90 blur-[3px]' : ''}`}
			aria-hidden={dragActive ? true : undefined}
		>
			{#key routeKey}
				{@render pageContent()}
			{/key}
		</div>

		<MobileShellNav {selfNavLabel} {selfActive} />
	{/if}
</div>
