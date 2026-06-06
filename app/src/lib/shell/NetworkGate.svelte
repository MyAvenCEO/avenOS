<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { avenCeoClaim, jazzSession } from '$lib/jazz/api'
	import { copyToClipboard } from '$lib/runtime/clipboard'

	// Shown (full-screen) when this device is unlocked but NOT yet a member of the
	// network's avenCEO spark: invite-only gate. Either be invited (share your DID
	// with an admin) or — if no one has claimed the network yet — claim it.
	let ownDid = $state('')
	let claimBusy = $state(false)
	let claimErr = $state<string | undefined>(undefined)
	let didCopied = $state(false)

	$effect(() => {
		if (!browser) return
		void (async () => {
			try {
				ownDid = (await jazzSession()).peerDid ?? ''
			} catch {
				ownDid = ''
			}
		})()
	})

	async function claim(): Promise<void> {
		claimBusy = true
		claimErr = undefined
		try {
			// On success the avenCEO row syncs locally → membership flips → the gate
			// unmounts and the app shows (the layout watches sparksStore).
			await avenCeoClaim()
		} catch (e) {
			claimErr = e instanceof Error ? e.message : String(e)
		} finally {
			claimBusy = false
		}
	}

	async function copyDid(): Promise<void> {
		if (!ownDid) return
		if (await copyToClipboard(ownDid)) {
			didCopied = true
			setTimeout(() => (didCopied = false), 1500)
		}
	}
</script>

<div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
	<div class="flex w-full max-w-md flex-col gap-7">
		<header class="space-y-1.5 text-center">
			<h1 class="text-2xl font-semibold tracking-tight">{t('networkGate.title')}</h1>
		</header>

		<!-- Invite path: share your DID with an admin (DID-push onboarding). -->
		<section class="border-border/50 bg-card/40 flex flex-col gap-3 rounded-xl border p-5">
			<p class="text-muted-foreground text-sm leading-relaxed">{t('networkGate.needInvite')}</p>
			<div class="flex flex-col gap-1">
				<span class="text-[11px] font-semibold tracking-wider uppercase opacity-60">{t('networkGate.yourDid')}</span>
				<code class="border-border/50 bg-background/50 text-muted-foreground rounded-md border px-3 py-2 font-mono text-[11px] break-all select-text">{ownDid}</code>
			</div>
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 self-start rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
				disabled={!ownDid}
				onclick={() => void copyDid()}>{didCopied ? t('networkGate.copied') : t('networkGate.copyDid')}</button
			>
		</section>

		<!-- First-admin path: claim the unclaimed network. -->
		<section class="border-border/50 flex flex-col gap-3 rounded-xl border border-dashed p-5">
			<div class="flex flex-col gap-1">
				<h2 class="text-sm font-semibold">{t('networkGate.firstTitle')}</h2>
				<p class="text-muted-foreground text-xs leading-relaxed">{t('networkGate.firstHint')}</p>
			</div>
			<button
				type="button"
				class="bg-muted hover:bg-muted/70 self-start rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
				disabled={claimBusy}
				onclick={() => void claim()}>{claimBusy ? t('networkGate.claiming') : t('networkGate.claim')}</button
			>
			{#if claimErr}
				<p class="text-destructive text-sm">{claimErr}</p>
			{/if}
		</section>
	</div>
</div>
