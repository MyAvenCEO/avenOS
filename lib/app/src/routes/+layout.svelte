<script lang="ts">
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { browser } from '$app/environment'
import { ensureComposerTauriShortcutBridge } from '$lib/intent-mock/composer-tauri-bridge'
import { pendingIntentFileDrop } from '$lib/intents/global-file-drop'
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

$effect(() => {
	if (shellLocked) pendingIntentFileDrop.set(null)
})

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
			{@render pageContent()}
		</div>
	{/if}
</div>
