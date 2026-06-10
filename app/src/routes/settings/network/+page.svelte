<script lang="ts">
	import { browser } from '$app/environment'
	import { avendbSession } from '$lib/avendb/api'
	import { waitForAvenDbSessionReady } from '$lib/runtime/avendb-runtime'
	import { deviceSession } from '$lib/settings/device-session-store'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { t } from '$lib/i18n'

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())

	let ownDid = $state<string>('')
	let err = $state<string | undefined>()
	let busy = $state(false)
	let copied = $state(false)
	let loadGen = 0

	async function load(): Promise<void> {
		if (!tauri || !unlocked) {
			ownDid = ''
			return
		}
		const gen = ++loadGen
		busy = true
		err = undefined
		try {
			await waitForAvenDbSessionReady()
			const session = await avendbSession()
			if (gen !== loadGen) return
			ownDid = session.signerDid
		} catch (e) {
			if (gen !== loadGen) return
			err = e instanceof Error ? e.message : String(e)
		} finally {
			if (gen === loadGen) busy = false
		}
	}

	async function copyOwnDid(): Promise<void> {
		if (!browser || !ownDid) return
		try {
			await navigator.clipboard.writeText(ownDid)
			copied = true
			setTimeout(() => (copied = false), 1500)
		} catch {
			/* clipboard blocked — DID is selectable in the field */
		}
	}

	$effect(() => {
		void $deviceSession
		void load()
	})
</script>

<div class="flex w-full max-w-2xl flex-col gap-8">
	<header class="flex flex-col gap-1">
		<h1 class="text-lg font-semibold">{t('peers.title')}</h1>
		<p class="text-muted-foreground text-sm">{t('peers.subtitle')}</p>
	</header>

	{#if !tauri || !unlocked}
		<p class="text-muted-foreground text-sm">{t('identities.needsDesktop')}</p>
	{:else}
		<!-- Your peer ID (share so others can add you to a identity). Access itself is
		     identity-scoped — manage members in each identity's Members page. -->
		<section class="flex flex-col gap-2">
			<h2 class="text-xs font-bold tracking-widest uppercase opacity-60">{t('peers.yourId')}</h2>
			<div class="flex items-center gap-2">
				<code class="bg-muted/40 min-w-0 flex-1 truncate rounded-lg px-3 py-2 font-mono text-[11px] select-all" title={ownDid}>{ownDid || '…'}</code>
				<button
					type="button"
					class="bg-muted hover:bg-muted/70 shrink-0 rounded-lg px-3 py-2 text-xs font-medium"
					onclick={() => void copyOwnDid()}
					disabled={!ownDid}>{copied ? t('peers.copied') : t('peers.copy')}</button
				>
			</div>
			<p class="text-muted-foreground text-xs leading-relaxed">{t('peers.shareHint')}</p>
			{#if err}
				<p class="text-destructive text-sm">{err}</p>
			{/if}
		</section>
	{/if}
</div>
