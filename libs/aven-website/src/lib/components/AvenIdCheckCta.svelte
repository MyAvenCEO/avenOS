<script lang="ts">
import ReservedNamesBoard from '$lib/components/ReservedNamesBoard.svelte'
import { type Lang, pick } from '$lib/i18n'
import { common } from '$lib/i18n/common'
import { idFunnelHref } from '$lib/id-service'
import { euro, plan } from '$lib/pricing/plans'

type Props = {
	variant?: 'inline' | 'banner'
	lang?: Lang
}

let { variant = 'inline', lang = 'de' }: Props = $props()

const t = $derived(pick(common, lang).idCta)
const avenId = plan('avenid')

let name = $state('')

const slug = $derived(
	name
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, '')
		.replace(/^-+|-+$/g, '')
		.slice(0, 24)
)

function submit(e: SubmitEvent) {
	e.preventDefault()
	if (!slug) return
	window.location.href = idFunnelHref('avenid', slug)
}

const wrapperClass =
	variant === 'banner'
		? 'rounded-2xl border border-border/45 bg-surface-raised px-5 py-8 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:px-10 sm:py-10'
		: 'rounded-2xl border border-border/40 bg-surface-raised px-5 py-7 sm:px-8 sm:py-8'
</script>

<form onsubmit={submit} class={wrapperClass} aria-label={t.formLabel}>
	<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{t.eyebrow}</p>
	<h3
		class="mt-2 text-xl font-semibold tracking-tight text-pretty text-foreground sm:text-2xl md:text-[1.65rem]"
	>
		{t.title(euro(avenId.eurPrice))}
	</h3>
	<!-- Our own static copy with inline emphasis — not user content. -->
	<p class="mt-3 max-w-2xl text-[14px] leading-snug text-foreground/68 sm:text-[15px]">
		{@html t.bodyHtml}
	</p>
	<div class="mt-6 flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
		<label
			class="flex min-h-12 flex-1 items-center gap-2 rounded-full border border-border/60 bg-surface-raised px-4"
		>
			<input
				bind:value={name}
				type="text"
				name="aven-name"
				autocomplete="off"
				spellcheck="false"
				placeholder={t.placeholder}
				class="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-medium tracking-tight text-foreground outline-none placeholder:text-foreground/35"
			>
			<span class="shrink-0 text-[13px] text-foreground/55">.aven.ceo</span>
		</label>
		<button
			type="submit"
			disabled={!slug}
			class="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-primary px-7 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40 sm:px-8"
		>
			{t.button}
		</button>
	</div>
	<p class="mt-3 text-[12px] leading-snug text-foreground/55">
		{t.exampleLabel} <strong class="font-semibold text-foreground/75">maia.aven.ceo</strong>
		<span class="text-foreground/45"> · </span>
		{t.priceNote(euro(avenId.eurPrice))}
	</p>
	<ReservedNamesBoard {lang} />
</form>
