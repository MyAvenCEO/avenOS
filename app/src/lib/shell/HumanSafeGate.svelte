<script lang="ts">
	import { tick } from 'svelte'
	import { t } from '$lib/i18n'
	import { createIdentity } from '$lib/jazz/api'

	// Shown full-screen once, right after first sign-in: the device has a signer + vault
	// but no HUMAN SAFE yet. We ask for the person's name and auto-create their human
	// SAFE (did:safe) — the identity the network invite/SYNC caps are granted to. Once it
	// exists the parent gate advances on its own (the safes store gains a human row).
	let name = $state('')
	let creating = $state(false)
	let err = $state<string | undefined>()
	let inputEl = $state<HTMLInputElement | null>(null)

	$effect(() => {
		void tick().then(() => inputEl?.focus())
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
</script>

<div class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
	<div class="flex w-full max-w-xl flex-col gap-6">
		<header class="space-y-3">
			<p class="text-primary text-[11px] font-bold tracking-[0.2em] uppercase">
				{t('humanGate.kicker')}
			</p>
			<h1 class="text-3xl leading-tight font-semibold tracking-tight">{t('humanGate.title')}</h1>
		</header>

		<p class="text-muted-foreground leading-relaxed">{t('humanGate.body')}</p>

		<div class="relative">
			<input
				bind:this={inputEl}
				bind:value={name}
				class="border-input bg-background/97 w-full min-h-[3.75rem] rounded-full border px-5 py-3 pr-[3.75rem] text-lg shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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

		<p class="text-muted-foreground/70 text-xs leading-relaxed">{t('humanGate.footnote')}</p>
	</div>
</div>
