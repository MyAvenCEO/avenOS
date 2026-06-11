<script lang="ts">
import { browser } from '$app/environment'
import { goto } from '$app/navigation'
import { page } from '$app/state'
import { installConsoleCapture } from '$lib/debug/console-capture'
import { initLocale, normalizeLocale, setLocale, t } from '$lib/i18n'
import { pendingIntentFileDrop } from '$lib/intents/global-file-drop'
import { startPeerMeshStore } from '$lib/peer/peer-mesh-store'
import { attachAvenosRuntimeBridge, avendbSessionReady } from '$lib/runtime/avendb-runtime'
import { avenCeoMembership } from '$lib/avendb/api'
import { avenDbStore } from '$lib/avendb/store.svelte'
import NetworkGate from '$lib/shell/NetworkGate.svelte'
import HumanSafeGate from '$lib/shell/HumanSafeGate.svelte'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { displayTitleForSession } from '$lib/settings/active-vault-ui'
import { attachSelfRustEventMirrors, deviceSession } from '$lib/settings/device-session-store'
import LockGate from '$lib/settings/LockGate.svelte'
import { type VaultListEntry, vaultCardTitle, vaultList } from '$lib/settings/vault'
import { vaultUiSettingsGet } from '$lib/settings/vault-ui-settings'
import { navigateApp } from '$lib/shell'
import MobileShellNav from '$lib/shell/MobileShellNav.svelte'
import { startAsrReadiness } from '$lib/asr/model-download-store'
import '../app.css'

if (browser) installConsoleCapture()

let { children: pageContent } = $props()

const path = $derived(page.url.pathname)
const routeKey = $derived(`${page.url.pathname}${page.url.search}`)
const intentsActive = $derived(path === '/')
const sandboxActive = $derived(path.startsWith('/sandbox'))
const selfActive = $derived(path.startsWith('/settings'))
const sparksNavActive = $derived(path.startsWith('/identities'))
const avensActive = $derived(path.startsWith('/avens'))

const shellLocked = $derived(browser && isTauriRuntime() && $deviceSession.kind === 'locked')

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

// On-device voice model: track download/readiness for the ambient indicator.
$effect(() => {
	if (!browser || !isTauriRuntime()) return () => {}
	let active = true
	let unsub = () => {}
	void startAsrReadiness().then((u) => {
		if (active) unsub = u
		else u()
	})
	return () => {
		active = false
		unsub()
	}
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

/** Mesh touches avenDB ACL — defer until strict local-first bootstrap confirms shell hydrate. */
const meshAllowed = $derived(sessionKind === 'unlocked' && $avendbSessionReady)

// Global invite-only gate: the app is locked behind membership of the network's
// avenCEO identity. Membership = "do I hold an avenCEO cap in my vault?" (a local
// vault check via the membership IPC) — the aven-node is the authority that
// grants caps (auto-grants the first peer, invites the rest). We re-check when
// identities sync, so the gate opens automatically once the server's grant + keyshare
// land and hydrate avenCEO into the vault. Sandbox (non-tauri) is never gated.
const identitiesStore = avenDbStore('safes')
let membership = $state<'owner' | 'member' | 'none' | 'unknown'>('unknown')
$effect(() => {
	void sessionKind
	void $avendbSessionReady
	void identitiesStore.rows
	if (!browser || !isTauriRuntime() || sessionKind !== 'unlocked' || !$avendbSessionReady) {
		membership = 'unknown'
		return
	}
	void (async () => {
		try {
			membership = await avenCeoMembership()
		} catch {
			membership = 'unknown'
		}
	})()
})
// Gate reactivity: while the invite gate is up (membership none/unknown), poll so it
// opens the moment the avenCEO admission syncs in + re-hydrates — without a reload.
$effect(() => {
	if (!browser || !isTauriRuntime() || sessionKind !== 'unlocked') return
	if (membership !== 'none' && membership !== 'unknown') return
	let active = true
	const id = setInterval(() => {
		void (async () => {
			try {
				const m = await avenCeoMembership()
				if (active) membership = m
			} catch {
				/* keep polling */
			}
		})()
	}, 3000)
	return () => {
		active = false
		clearInterval(id)
	}
})
// Step 2 of onboarding: after sign-in, every self needs a HUMAN SAFE (the did:safe the
// network invite/SYNC caps are granted to). Created locally — no network needed — so it
// gates BEFORE the invite gate. avenCEO syncs in as type "aven", so it never satisfies this.
const hasHumanSafe = $derived(identitiesStore.rows.some((r) => r.type === 'human'))
const appAccessState = $derived.by<'app' | 'human' | 'gate' | 'checking'>(() => {
	if (!browser || !isTauriRuntime() || sessionKind !== 'unlocked') return 'app'
	if (membership === 'unknown' || !identitiesStore.loaded) return 'checking'
	if (!hasHumanSafe) return 'human'
	return membership === 'none' ? 'gate' : 'app'
})

// After the invite gate opens, land on /identities (not /intents) — the user
// creates an identity (+ New) or opens ones shared with them via caps.
let landedPostInvite = $state(false)
$effect(() => {
	if (!browser || !isTauriRuntime()) return
	if (appAccessState === 'app' && !landedPostInvite && page.url.pathname === '/') {
		landedPostInvite = true
		void goto('/identities')
	}
})

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
		// E3: dropping on an identity screen stays in place — the identity's composer
		// consumes the pending drop and the files ingest into THAT identity's db/brain.
		const onIdentityScreen = page.url.pathname.startsWith('/identities/')
		if (!onIdentityScreen && page.url.pathname !== '/') {
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
		{#if appAccessState === 'checking'}
			<div class="flex min-h-0 flex-1 items-center justify-center p-6">
				<p class="text-muted-foreground text-sm">{t('networkGate.checking')}</p>
			</div>
		{:else if appAccessState === 'human'}
			<HumanSafeGate />
		{:else if appAccessState === 'gate'}
			<NetworkGate />
		{:else}
		<header
			class="shrink-0 bg-background/90 px-3 pt-[max(0.375rem,env(safe-area-inset-top))] pb-1 backdrop-blur-sm sm:px-6 sm:pt-3 sm:pb-2"
		>
			<div
				class="mx-auto grid w-full max-w-[min(100%,88rem)] grid-cols-1 items-center gap-x-2 gap-y-2 sm:grid-cols-3"
			>
				<div
					class="flex min-w-0 items-center justify-start justify-self-start sm:justify-self-start"
				></div>

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
						href="/identities"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {sparksNavActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={sparksNavActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/identities', e)}
						>{t('nav.identities')}</a
					>
					<span class="select-none opacity-25" aria-hidden="true">|</span>
					<a
						href="/avens"
						data-sveltekit-preload-data="hover"
						class="transition-opacity hover:opacity-80 {avensActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={avensActive ? 'page' : undefined}
						onclick={(e) => navigateApp('/avens', e)}
						>{t('nav.avens')}</a
					>
				</nav>

				<nav
					class="hidden min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 justify-self-end text-[10px] font-bold tracking-wider uppercase sm:flex"
					aria-label={t('nav.deviceIdentity')}
				>
					<a
						href="/settings/identity"
						data-sveltekit-preload-data="hover"
						class="normal-case max-w-[8rem] truncate text-[11px] font-semibold tracking-normal transition-opacity hover:opacity-80 sm:max-w-[10rem] {selfActive ? 'opacity-95' : 'opacity-40'}"
						aria-current={selfActive ? 'page' : undefined}
						title={selfNavLabel}
						onclick={(e) => navigateApp('/settings/identity', e)}
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
