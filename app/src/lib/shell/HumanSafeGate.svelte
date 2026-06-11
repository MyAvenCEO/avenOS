<script lang="ts">
	import { tick } from 'svelte'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { createIdentity, avendbSession } from '$lib/avendb/api'
	import { copyToClipboard } from '$lib/runtime/clipboard'

	// Shown full-screen once, right after first sign-in: the device has a signer + vault
	// but no HUMAN SAFE yet. Two ways forward:
	//   • Create — name yourself → mint a new human SAFE (did:safe) on this device.
	//   • Pair   — this is another device of an existing self: show its signer did:key so
	//     the existing account adds it as an OWNER of their human SAFE. Once that grant
	//     syncs in, a human row appears and the parent gate advances on its own.
	type Mode = 'choose' | 'create' | 'pair'
	let mode = $state<Mode>('choose')

	let name = $state('')
	let creating = $state(false)
	let err = $state<string | undefined>()
	let inputEl = $state<HTMLInputElement | null>(null)

	let signerDid = $state('')
	let didCopied = $state(false)

	$effect(() => {
		if (mode === 'create') void tick().then(() => inputEl?.focus())
	})

	$effect(() => {
		if (!browser || mode !== 'pair' || signerDid) return
		void (async () => {
			try {
				signerDid = (await avendbSession()).signerDid ?? ''
			} catch {
				signerDid = ''
			}
		})()
	})

	async function submit(): Promise<void> {
		const n = name.trim()
		if (!n || creating) return
		creating = true
		err = undefined
		try {
			await createIdentity(n, 'human')
			// On success the parent's safes store gains a `type === 'human'` row and this
			// gate is replaced automatically — no navigation needed here.
		} catch (e) {
			err = e instanceof Error ? e.message : String(e)
			creating = false
		}
	}

	async function copyDid(): Promise<void> {
		if (!signerDid) return
		if (await copyToClipboard(signerDid)) {
			didCopied = true
			setTimeout(() => (didCopied = false), 1500)
		}
	}

	const pillInput =
		'border-input bg-background/97 w-full min-h-[3.75rem] rounded-full border px-5 py-3 pr-[3.75rem] text-lg shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
	const choiceBtn =
		'hover:bg-accent/10 flex w-full flex-col gap-1 rounded-xl border border-border/60 bg-background/97 px-5 py-4 text-left shadow-sm backdrop-blur-sm transition-[background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
	const backBtn =
		'border-input text-foreground hover:bg-accent self-start rounded-lg border px-4 py-2 text-sm font-medium'
</script>

<div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
	<div class="flex w-full max-w-xl flex-col gap-6">
		<header class="space-y-3">
			<p class="text-primary text-[11px] font-bold tracking-[0.2em] uppercase">
				{t('humanGate.kicker')}
			</p>
			<h1 class="text-3xl leading-tight font-semibold tracking-tight">
				{mode === 'pair' ? t('humanGate.pairTitle') : t('humanGate.title')}
			</h1>
		</header>

		{#if mode === 'choose'}
			<p class="text-muted-foreground leading-relaxed">{t('humanGate.body')}</p>
			<div class="flex flex-col gap-3">
				<button type="button" class={choiceBtn} onclick={() => (mode = 'create')}>
					<span class="text-sm font-semibold">{t('humanGate.createOption')}</span>
					<span class="text-muted-foreground text-xs leading-snug">
						{t('humanGate.createOptionDesc')}
					</span>
				</button>
				<button type="button" class={choiceBtn} onclick={() => (mode = 'pair')}>
					<span class="text-sm font-semibold">{t('humanGate.pairOption')}</span>
					<span class="text-muted-foreground text-xs leading-snug">
						{t('humanGate.pairOptionDesc')}
					</span>
				</button>
			</div>
		{:else if mode === 'create'}
			<p class="text-muted-foreground leading-relaxed">{t('humanGate.body')}</p>
			<div class="relative">
				<input
					bind:this={inputEl}
					bind:value={name}
					class={pillInput}
					autocomplete="name"
					placeholder={t('humanGate.namePlaceholder')}
					aria-label={t('humanGate.title')}
					disabled={creating}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault()
							void submit()
						}
					}}
				/>
				<button
					type="button"
					class="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--color-brand-navy)] text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 disabled:opacity-40"
					aria-label={t('humanGate.createButton')}
					disabled={creating || !name.trim()}
					onclick={() => void submit()}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M5 12h14" />
						<path d="m12 5 7 7-7 7" />
					</svg>
				</button>
			</div>
			{#if creating}
				<p class="text-muted-foreground text-sm" aria-live="polite">{t('humanGate.creating')}</p>
			{/if}
			{#if err}
				<p class="text-sm text-red-500" aria-live="polite">{err}</p>
			{/if}
			<button type="button" class={backBtn} onclick={() => (mode = 'choose')}>
				{t('common.back')}
			</button>
		{:else}
			<p class="text-muted-foreground leading-relaxed">{t('humanGate.pairBody')}</p>
			<section class="border-border/50 bg-card/40 flex flex-col gap-3 rounded-xl border p-5">
				<span class="text-[11px] font-semibold tracking-wider uppercase opacity-60">
					{t('humanGate.yourSignerDid')}
				</span>
				<code
					class="border-border/50 bg-background/50 text-muted-foreground rounded-md border px-3 py-2 font-mono text-[11px] break-all select-text"
					>{signerDid}</code
				>
				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 self-start rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
					disabled={!signerDid}
					onclick={() => void copyDid()}
				>
					{didCopied ? t('humanGate.copied') : t('humanGate.copySignerDid')}
				</button>
			</section>
			<p class="text-muted-foreground/80 text-sm leading-relaxed" aria-live="polite">
				{t('humanGate.pairWaiting')}
			</p>
			<button type="button" class={backBtn} onclick={() => (mode = 'choose')}>
				{t('common.back')}
			</button>
		{/if}

		<p class="text-muted-foreground/70 text-xs leading-relaxed">{t('humanGate.footnote')}</p>
	</div>
</div>
