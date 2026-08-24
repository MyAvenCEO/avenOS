<!-- The withdrawal page, both languages: the eRecht24 revocation button on
     top for people who came to act, the statutory Widerrufsbelehrung
     (EGBGB Anlage 1 / EU model instruction) below for people who came to
     read, and the button once more at the bottom so nobody scrolls back up. -->
<script lang="ts">
import { legalDocument, REVOCATION_WIDGET } from '@avenos/aven-brand'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import type { Lang } from '$lib/i18n'

let { lang }: { lang: Lang } = $props()

const doc = $derived(legalDocument('widerruf', lang))
const t = $derived(
	lang === 'de'
		? {
				eyebrow: 'Rechtliches',
				intro: 'Du möchtest einen Vertrag widerrufen? Nutze dafür unser Online-Widerrufsformular:',
				button: 'Vertrag widerrufen',
				buttonAria: 'Vertrag widerrufen',
				buttonTitle: 'Widerrufsformular konnte nicht geladen werden'
			}
		: {
				eyebrow: 'Legal',
				intro: 'You want to withdraw from a contract? Use our online withdrawal form:',
				button: 'Withdraw from contract',
				buttonAria: 'Withdraw from contract',
				buttonTitle: 'The withdrawal form could not be loaded'
			}
)
</script>

<svelte:head>
	<title>{doc.title} — aven.ceo</title>
	<!-- The eRecht24 widget: finds the anchor by its id, removes the disabled
	     state and opens the hosted revocation form. -->
	<script async src={REVOCATION_WIDGET.scriptSrc}></script>
</svelte:head>

<div {lang} class="flex min-h-screen flex-col bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader {lang} />

	<section class="flex-1 px-5 py-16 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{t.eyebrow}</p>
			<h1 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
				{doc.title}
			</h1>

			<!-- Widerrufsbutton für den Shop "avenCEO GmbH" (eRecht24). -->
			<div class="mt-8 rounded-2xl border border-border/50 bg-surface-card p-6">
				<p class="text-[14px] leading-relaxed text-foreground/75">{t.intro}</p>
				<p class="mt-4">
					<a
						id="eRecht24RevocationButton"
						href={REVOCATION_WIDGET.href}
						data-shop-id={REVOCATION_WIDGET.shopId}
						data-key={REVOCATION_WIDGET.embedKey}
						aria-label={t.buttonAria}
						aria-disabled="true"
						title={t.buttonTitle}
						style="opacity:.5"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						<span>{t.button}</span>
					</a>
				</p>
			</div>

			<!-- The statutory instruction, straight from the brand SSOT. -->
			{#each doc.sections as section, s (s)}
				{#if section.title}
					<h2 class="mt-10 text-[17px] font-semibold tracking-tight text-foreground">
						{section.title}
					</h2>
				{/if}
				{#each section.blocks as block, i (i)}
					{#if 'lines' in block}
						<p class="mt-3 text-[15px] leading-relaxed text-foreground/75">
							{#each block.lines as line, l (l)}
								{#if l > 0}
									<br>
								{/if}
								{line}
							{/each}
						</p>
					{/if}
				{/each}
			{/each}

			<!-- The button once more, under the form text — where the reader
			     lands after reading the Belehrung. A plain link (no widget id):
			     the hosted form works standalone, and duplicate widget ids
			     would confuse the upgrade script. -->
			<div class="mt-10 rounded-2xl border border-border/50 bg-surface-card p-6 text-center">
				<a
					href={REVOCATION_WIDGET.href}
					target="_blank"
					rel="noopener noreferrer"
					class="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
				>
					{t.button}
				</a>
			</div>
		</div>
	</section>

	<SiteFooter {lang} />
</div>
