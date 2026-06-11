<script lang="ts">
	import { t } from '$lib/i18n'
	import { avenDbStore } from '$lib/avendb/store.svelte'
	import { copyToClipboard } from '$lib/runtime/clipboard'

	// Shown full-screen when this device is unlocked but NOT yet a member of the
	// network's avenCEO identity. Invitation-only: the aven-node auto-grants the first
	// peer; everyone else shares their HUMAN SAFE did:safe with a founder to be vouched
	// in. The SYNC/membership cap is granted to the human SAFE — never the raw device
	// signer — and the device's signers inherit it through SAFE membership.
	const safesStore = avenDbStore('safes')
	const humanSafe = $derived(safesStore.rows.find((r) => r.type === 'human'))
	const ownDid = $derived(humanSafe ? `did:safe:${String(humanSafe.owner ?? '').trim()}` : '')
	let didCopied = $state(false)
	async function copyDid(): Promise<void> {
		if (!ownDid) return
		if (await copyToClipboard(ownDid)) {
			didCopied = true
			setTimeout(() => (didCopied = false), 1500)
		}
	}
</script>

<div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
	<div class="flex w-full max-w-xl flex-col gap-6">
		<header class="space-y-3">
			<p class="text-primary text-[11px] font-bold tracking-[0.2em] uppercase">{t('networkGate.kicker')}</p>
			<h1 class="text-3xl leading-tight font-semibold tracking-tight">{t('networkGate.title')}</h1>
		</header>

		<p class="text-muted-foreground leading-relaxed">{t('networkGate.body')}</p>
		<p class="text-muted-foreground leading-relaxed">{t('networkGate.how')}</p>

		<section class="border-border/50 bg-card/40 flex flex-col gap-3 rounded-xl border p-5">
			<span class="text-[11px] font-semibold tracking-wider uppercase opacity-60">{t('networkGate.yourDid')}</span>
			<code class="border-border/50 bg-background/50 text-muted-foreground rounded-md border px-3 py-2 font-mono text-[11px] break-all select-text">{ownDid}</code>
			<button
				type="button"
				class="bg-primary text-primary-foreground hover:bg-primary/90 self-start rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
				disabled={!ownDid}
				onclick={() => void copyDid()}>{didCopied ? t('networkGate.copied') : t('networkGate.copyDid')}</button
			>
		</section>

		<p class="text-muted-foreground/70 text-xs leading-relaxed">{t('networkGate.footnote')}</p>
	</div>
</div>
