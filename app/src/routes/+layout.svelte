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
import { initLocale, normalizeLocale, setLocale, t } from '$lib/i18n'
import LockGate from '$lib/settings/LockGate.svelte'
import { attachSelfRustEventMirrors, deviceSession } from '$lib/settings/device-session-store'
import { displayTitleForSession } from '$lib/settings/active-vault-ui'
import { vaultUiSettingsGet } from '$lib/settings/vault-ui-settings'
import { vaultCardTitle, vaultList, type VaultListEntry } from '$lib/settings/vault'
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
const selfActive = $derived(path.startsWith('/settings'))
const vaultActive = $derived(path.startsWith('/vault'))
const vaultEmbed = $derived(page.url.searchParams.get('vaultEmbed') === '1')
const sparksNavActive = $derived(path.startsWith('/sparks'))
const dbActive = $derived(path.startsWith('/db'))
const avenCityActive = $derived(path.startsWith('/aven-city'))

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

$effect(() => {
	if (!browser || !isTauriRuntime()) return
	initLocale('en')
})

let vaults = $state<VaultListEntry[]>([])

$effect(() => {
	void sessionKind
	if (!browser || !isTauriRuntime()) return
	void (async () => {
		try {
			vaults = await vaultList()
		} catch {
			vaults = []
		}
	})()
})

$effect(() => {
	if (!browser || !isTauriRuntime()) return
	void sessionKind
	void vaults
	if (sessionKind === 'locked') {
		if (vaults.length > 0) {
			const entry = vaults.find((v) => v.hasIdentityBlob) ?? vaults[0]
			if (entry?.locale) setLocale(normalizeLocale(entry.locale))
		}
		return
	}
	void (async () => {
		try {
			const settings = await vaultUiSettingsGet()
			setLocale(settings.locale)
		} catch {
			/* keep current locale */
		}
	})()
})

/** Mesh touches Groove ACL — defer until strict local-first bootstrap confirms shell hydrate. */
const meshAllowed = $derived(
	sessionKind === 'unlocked' && $grooveSessionReady,
)

$effect(() => {
	if (!browser || !isTauriRuntime() || !meshAllowed) return
	return startPeerMeshStore()
})

const selfNavLabel = $derived.by(() => {
	const ds = $deviceSession
	const title =
		ds.kind === 'unlocked'
			? displayTitleForSession(vaults, ds)
			: vaults.length > 0
				? vaultCardTitle(vaults[0])
				: t('nav.self')
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
	{#if vaultEmbed}
		<div class="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{#key routeKey}
				{@render pageContent()}
			{/key}
		</div>
	{:else}
	<LockGate />
	{#if !shellLocked}
		<header class="shrink-0 bg-background/90 px-3 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1 backdrop-blur-sm sm:px-6 sm:pt-3 sm:pb-2">
			<div
				class="mx-auto grid w-full max-w-[min(100%,88rem)] grid-cols-1 items-center gap-x-2 gap-y-2 sm:grid-cols-3"
			>
				<div class="flex min-w-0 items-center justify-start justify-self-start sm:justify-self-start">
					<P2pSyncBadge />
				</div>

				<nav
					class="hidden flex-wrap items-center justify-center justify-self-center gap-x-2 gap-y-1 text-[10px] font-bold tracking-wider uppercase sm:flex"
					aria-label={t('nav.appSections')}
				>
					<a
						href="/"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {intentsActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={intentsActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/', e)}
						>{t('nav.intents')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/sandbox"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sandboxActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sandboxActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/sandbox', e)}
						>{t('nav.sandbox')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/sparks"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sparksNavActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sparksNavActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/sparks', e)}
						>{t('nav.sparks')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/db"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {dbActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={dbActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/db', e)}
						>{t('nav.db')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/aven-city"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {avenCityActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={avenCityActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/aven-city', e)}
						>{t('nav.avenCity')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/vault"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {vaultActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={vaultActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/vault', e)}
						>{t('nav.vault')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/docs"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {docsActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={docsActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/docs', e)}
						>{t('nav.docs')}</a
					>
				</nav>

				<nav
					class="hidden min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 justify-self-end text-[10px] font-bold tracking-wider uppercase sm:flex"
					aria-label={t('nav.deviceIdentity')}
				>
					<a
						href="/settings/peers"
						data-sveltekit-preload-data="hover"
						class="normal-case max-w-[8rem] truncate text-[11px] font-semibold tracking-normal transition-opacity hover:opacity-80 sm:max-w-[10rem] {selfActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={selfActive ? 'page' : undefined}
						title={selfNavLabel}
						onclick={(e) => navigateApp('/settings/peers', e)}
						>{selfNavLabel}</a
					>
				</nav>
			</div>
		</header>
		{#if dragActive}
			<div
				class="pointer-events-auto fixed inset-0 z-[100] flex touch-none items-center justify-center bg-background/95 backdrop-blur-md"
				role="region"
				aria-label={t('intents.fileDrop.region')}
			>
				<div class="mx-6 w-full max-w-md">
					<div
						class="rounded-[var(--radius-lg)] border-[3px] border-dashed border-primary/50 bg-card/96 p-[10px] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_14%,transparent)] ring-2 ring-primary/20 ring-offset-[8px] ring-offset-background backdrop-blur-sm"
					>
						<div
							class="rounded-[calc(var(--radius-lg)-8px)] border border-dotted border-primary/40 bg-muted/40 px-7 py-9 text-center"
						>
							<p class="text-xl font-semibold tracking-tight text-primary md:text-[1.3rem]">
								{t('intents.fileDrop.title')}
							</p>
							<p class="mt-2.5 px-1 text-[12px] leading-relaxed opacity-85">
								{t('intents.fileDrop.subtitle')}
							</p>
							<p class="mt-1.5 px-1 text-[11px] leading-relaxed opacity-55">
								{t('intents.fileDrop.hint')}
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
	{/if}
</div>
