<script lang="ts">
import { type Lang, localeHref, pick } from '$lib/i18n'
import { common } from '$lib/i18n/common'
import { idFunnelHref } from '$lib/id-service'

/**
 * THE footer, on every page. It carries the two things a German site owes a
 * visitor — the legal pages and a way back into the site. The legal pages
 * are German-only; the English site links to them as they are.
 */
let { lang = 'de' }: { lang?: Lang } = $props()

const t = $derived(pick(common, lang))

const legal = $derived([
	{ href: '/impressum/', label: t.footer.legal.impressum },
	{ href: '/datenschutz/', label: t.footer.legal.datenschutz },
	{ href: '/agb/', label: t.footer.legal.agb },
	{ href: '/widerruf/', label: t.footer.legal.widerruf }
])

const nav = $derived([
	{ href: localeHref(lang, '/skills'), label: t.nav.skills },
	{ href: localeHref(lang, '/pricing'), label: t.nav.pricing },
	{ href: idFunnelHref(), label: t.footer.ctaLabel }
])

const year = 2026
</script>

<footer class="border-t border-border/40 px-5 py-10 sm:px-8">
	<div class="mx-auto flex max-w-6xl flex-col gap-8">
		<div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<a href={localeHref(lang, '/')} class="flex items-center gap-2.5">
					<img src="/aven-logo.svg" alt="" class="size-7" width="28" height="28">
					<span class="text-[15px] font-semibold tracking-tight text-foreground">avenCEO</span>
				</a>
				<p class="mt-2 max-w-xs text-[12px] leading-snug text-foreground/55">{t.footer.tagline}</p>
			</div>

			<nav class="flex flex-col gap-2 text-[13px]" aria-label={t.footer.pagesLabel}>
				{#each nav as item (item.href)}
					<a href={item.href} class="text-foreground/65 transition-colors hover:text-foreground">
						{item.label}
					</a>
				{/each}
			</nav>

			<nav class="flex flex-col gap-2 text-[13px]" aria-label={t.footer.legalLabel}>
				{#each legal as item (item.href)}
					<a href={item.href} class="text-foreground/65 transition-colors hover:text-foreground">
						{item.label}
					</a>
				{/each}
			</nav>
		</div>

		<div
			class="flex flex-col gap-2 border-t border-border/40 pt-6 text-[11px] text-foreground/40 sm:flex-row sm:items-center sm:justify-between"
		>
			<p>© {year} {t.footer.copyright}</p>
			<p>{t.footer.vat}</p>
		</div>
	</div>
</footer>
