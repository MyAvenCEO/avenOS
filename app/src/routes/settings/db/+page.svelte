<script lang="ts">
import { browser } from '$app/environment'
import { t } from '$lib/i18n'
import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
import { applyLockedFrontendState } from '$lib/settings/device-session-store'
import {
	type SelfStoragePathsReply,
	selfClearAvenDbDatabase,
	selfClearAvenOsData,
	selfStoragePaths
} from '$lib/settings/storage-api'

let paths = $state<SelfStoragePathsReply | undefined>()
let pathsErr = $state<string | undefined>()
let busy = $state(false)
let clearErr = $state<string | undefined>()
let clearDone = $state(false)
let confirmOpen = $state(false)
let fullResetErr = $state<string | undefined>()
let fullResetDone = $state(false)
let fullResetConfirmOpen = $state(false)

const tauri = $derived(browser && isTauriRuntime())

$effect(() => {
	if (!tauri) {
		paths = undefined
		pathsErr = undefined
		return
	}
	let cancelled = false
	void (async () => {
		try {
			pathsErr = undefined
			clearDone = false
			fullResetDone = false
			const p = await selfStoragePaths()
			if (!cancelled) paths = p
		} catch (e) {
			if (!cancelled) pathsErr = e instanceof Error ? e.message : String(e)
		}
	})()
	return () => {
		cancelled = true
	}
})

async function clearDb(): Promise<void> {
	if (!tauri || busy) return
	busy = true
	clearErr = undefined
	clearDone = false
	confirmOpen = false
	try {
		await selfClearAvenDbDatabase()
		clearDone = true
		paths = await selfStoragePaths()
	} catch (e) {
		clearErr = e instanceof Error ? e.message : String(e)
	} finally {
		busy = false
	}
}

async function clearAllAvenOsData(): Promise<void> {
	if (!tauri || busy) return
	busy = true
	fullResetErr = undefined
	fullResetDone = false
	fullResetConfirmOpen = false
	try {
		await selfClearAvenOsData()
		applyLockedFrontendState()
		fullResetDone = true
		paths = await selfStoragePaths()
	} catch (e) {
		fullResetErr = e instanceof Error ? e.message : String(e)
	} finally {
		busy = false
	}
}
</script>

<svelte:head>
	<title>{t('db.self.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex flex-col gap-8">
	<header class="space-y-1.5">
		<h1 class="text-2xl font-semibold tracking-tight">{t('db.self.title')}</h1>
		<p class="text-muted-foreground text-sm leading-relaxed">
			{t('db.self.subtitle')}
		</p>
	</header>

	{#if !tauri}
		<p class="text-muted-foreground text-sm">{t('db.self.needsDesktop')}</p>
	{:else if pathsErr}
		<p
			class="text-destructive border-destructive/40 bg-destructive/10 rounded-lg border px-3 py-2 text-sm leading-snug select-text"
			role="alert"
		>
			{pathsErr}
		</p>
	{:else if paths}
		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider opacity-70">
				{t('db.self.paths')}
			</h2>
			<dl class="space-y-3 text-[13px]">
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">
						{t('db.self.appRoot')}
					</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.appBase}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">
						{t('db.self.activeVault')}
					</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.root}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">
						{t('db.self.database')}
					</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">{paths.dbDir}</dd>
				</div>
				<div>
					<dt class="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wide">
						{t('db.self.selfIdentity')}
					</dt>
					<dd class="break-all font-mono text-[11px] leading-snug select-text">
						{paths.selfIdentityDir}
					</dd>
				</div>
			</dl>
		</section>

		<section class="space-y-3 rounded-xl border border-border/60 bg-card/30 p-4">
			<h2 class="text-[11px] font-semibold uppercase tracking-wider opacity-70">
				{t('db.self.avendbStore')}
			</h2>
			<p class="text-muted-foreground text-xs leading-relaxed">
				{t('db.self.clearDescription')}
			</p>

			{#if clearErr}
				<p
					class="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-xs select-text"
				>
					{clearErr}
				</p>
			{/if}
			{#if clearDone}
				<p
					class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md border px-3 py-2 text-xs"
				>
					{t('db.self.clearSuccess')}
				</p>
			{/if}

			{#if confirmOpen}
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
					<p class="text-sm font-medium">{t('db.self.confirmClearQuestion')}</p>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="border-destructive/60 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={busy}
							onclick={() => void clearDb()}
						>
							{busy ? t('common.clearing') : t('common.confirmClear')}
						</button>
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={busy}
							onclick={() => (confirmOpen = false)}
						>
							{t('common.cancel')}
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="border-destructive/50 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
					disabled={busy}
					onclick={() => {
						clearErr = undefined
						confirmOpen = true
					}}
				>
					{t('db.self.clearResetButton')}
				</button>
			{/if}
		</section>

		<section class="space-y-3 rounded-xl border border-destructive/35 bg-destructive/[0.04] p-4">
			<h2 class="text-destructive text-[11px] font-semibold uppercase tracking-wider">
				{t('db.self.dangerZone')}
			</h2>
			<p class="text-muted-foreground text-xs leading-relaxed">
				{t('db.self.fullResetDescription')}
			</p>

			{#if fullResetErr}
				<p
					class="text-destructive border-destructive/30 bg-destructive/5 rounded-md border px-3 py-2 text-xs select-text"
				>
					{fullResetErr}
				</p>
			{/if}
			{#if fullResetDone}
				<p
					class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-md border px-3 py-2 text-xs"
				>
					{t('db.self.fullResetSuccess')}
				</p>
			{/if}

			{#if fullResetConfirmOpen}
				<div class="flex flex-col gap-3">
					<p class="text-destructive text-sm font-medium">
						{t('db.self.fullResetConfirm', { path: paths.appBase })}
					</p>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							class="border-destructive text-destructive hover:bg-destructive/10 rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
							disabled={busy}
							onclick={() => void clearAllAvenOsData()}
						>
							{busy ? t('common.deleting') : t('common.yesDeleteEverything')}
						</button>
						<button
							type="button"
							class="border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
							disabled={busy}
							onclick={() => (fullResetConfirmOpen = false)}
						>
							{t('common.cancel')}
						</button>
					</div>
				</div>
			{:else}
				<button
					type="button"
					class="border-destructive/70 text-destructive hover:bg-destructive/10 rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-50"
					disabled={busy}
					onclick={() => {
						fullResetErr = undefined
						fullResetConfirmOpen = true
					}}
				>
					{t('db.self.fullResetButton')}
				</button>
			{/if}
		</section>
	{:else}
		<p class="text-muted-foreground text-sm">{t('common.loadingPaths')}</p>
	{/if}
</div>
