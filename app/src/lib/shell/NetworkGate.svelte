<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { jazzSession } from '$lib/jazz/api'
	import { copyToClipboard } from '$lib/runtime/clipboard'

	// Shown full-screen when this device is unlocked but NOT yet a member of the
	// network's avenCEO spark. The aven-server is the authority: the FIRST peer to
	// connect is auto-granted admin (the gate flips automatically); everyone else
	// shares their DID with an admin to be invited. No client-side claim.
	let ownDid = $state('')
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
		<header class="space-y-2 text-center">
			<h1 class="text-2xl font-semibold tracking-tight">{t('networkGate.title')}</h1>
			<p class="text-muted-foreground text-sm leading-relaxed">{t('networkGate.connectingHint')}</p>
		</header>

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
	</div>
</div>
