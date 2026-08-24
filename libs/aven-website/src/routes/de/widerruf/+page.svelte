<script lang="ts">
import { REVOCATION_WIDGET } from '@avenos/aven-brand'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
</script>

<svelte:head>
	<title>Widerrufsrecht — aven.ceo</title>
	<meta name="robots" content="noindex">
	<!-- The eRecht24 widget: it finds the anchor below by its id, removes the
	     disabled state and opens the hosted revocation form. -->
	<script async src={REVOCATION_WIDGET.scriptSrc}></script>
</svelte:head>

<div
	lang="de"
	class="flex min-h-screen flex-col bg-background text-foreground font-sans antialiased"
>
	<MarketingSiteHeader />

	<section class="flex-1 px-5 py-16 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">Rechtliches</p>
			<h1 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
				Widerrufsrecht
			</h1>
			<p class="mt-3 text-[15px] leading-relaxed text-foreground/68">
				Dein Widerrufsrecht und wie du es ausübst.
			</p>

			<!-- Widerrufsbutton für den Shop "avenCEO GmbH" (eRecht24). The
			     attributes come from the embed snippet; the async script
			     enables the button once the form is reachable. -->
			<div class="mt-8 rounded-2xl border border-border/50 bg-surface-card p-6">
				<p class="text-[14px] leading-relaxed text-foreground/75">
					Du möchtest einen Vertrag widerrufen? Nutze dafür unser Online-Widerrufsformular:
				</p>
				<p class="mt-4">
					<a
						id="eRecht24RevocationButton"
						href={REVOCATION_WIDGET.href}
						data-shop-id={REVOCATION_WIDGET.shopId}
						data-key={REVOCATION_WIDGET.embedKey}
						aria-label="Vertrag widerrufen"
						aria-disabled="true"
						title="Widerrufsformular konnte nicht geladen werden"
						style="opacity:.5"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						<span>Vertrag widerrufen</span>
					</a>
				</p>
			</div>

			<!-- PLACEHOLDER. The page stays noindex until the Widerrufsbelehrung
			     text is in it; a legal text that only looks like one helps nobody. -->
			<div class="mt-6 rounded-2xl border border-dashed border-quiet/55 bg-surface-soft/70 p-6">
				<p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-quiet-ink">
					Platzhalter
				</p>
				<p class="mt-2 text-[14px] leading-relaxed text-foreground/70">
					Hier steht bald die rechtsverbindliche Widerrufsbelehrung. Bis dahin ist diese Seite
					bewusst schlank und auf <span class="font-mono text-[13px]">noindex</span> gesetzt — ein
					Rechtstext, der nur so aussieht, als wäre er einer, hilft niemandem.
				</p>
			</div>
		</div>
	</section>

	<SiteFooter />
</div>
