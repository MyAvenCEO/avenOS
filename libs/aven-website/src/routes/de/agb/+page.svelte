<svelte:head>
	<title>Allgemeine Geschäftsbedingungen — aven.ceo</title>
	<meta name="robots" content="noindex">
</svelte:head>

<script lang="ts">
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
</script>

<div
	lang="de"
	class="flex min-h-screen flex-col bg-background text-foreground font-sans antialiased"
>
	<MarketingSiteHeader />

	<section class="flex-1 px-5 py-16 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">Rechtliches</p>
			<h1 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
				Allgemeine Geschäftsbedingungen
			</h1>
			<p class="mt-3 text-[15px] leading-relaxed text-foreground/68">
				Die Bedingungen, unter denen wir liefern.
			</p>

			<!-- PLACEHOLDER. This page is noindex until the real text is in it;
			     a legal page with invented content is worse than none. -->
			<div class="mt-8 rounded-2xl border border-dashed border-quiet/55 bg-surface-soft/70 p-6">
				<p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-quiet-ink">
					Platzhalter
				</p>
				<p class="mt-2 text-[14px] leading-relaxed text-foreground/70">
					Hier steht bald der rechtsverbindliche Text. Bis dahin ist diese Seite bewusst leer und
					auf <span class="font-mono text-[13px]">noindex</span> gesetzt — ein Rechtstext, der nur
					so aussieht, als wäre er einer, hilft niemandem.
				</p>
			</div>
		</div>
	</section>

	<SiteFooter />
</div>
