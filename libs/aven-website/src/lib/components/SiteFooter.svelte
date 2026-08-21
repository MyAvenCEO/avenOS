<script lang="ts">
import { idFunnelHref } from '$lib/id-service'

/**
 * THE footer, on every page. It carries the two things a German site owes a
 * visitor — the legal pages and a way back into the site — instead of the
 * one-line brand signature each page used to end on.
 */
const legal = [
	{ href: '/impressum', label: 'Impressum' },
	{ href: '/datenschutz', label: 'Datenschutz' },
	{ href: '/agb', label: 'AGB' },
	{ href: '/widerruf', label: 'Widerrufsrecht' }
]

const nav = [
	{ href: '/skills', label: 'Skills' },
	{ href: '/pricing', label: 'Preise' },
	{ href: idFunnelHref(), label: 'Sichere dir deinen Aven' }
]

const year = 2026
</script>

<footer class="border-t border-border/40 px-5 py-10 sm:px-8">
	<div class="mx-auto flex max-w-6xl flex-col gap-8">
		<div class="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<a href="/" class="flex items-center gap-2.5">
					<img src="/aven-logo.svg" alt="" class="size-7" width="28" height="28">
					<span class="text-[15px] font-semibold tracking-tight text-foreground">avenCEO</span>
				</a>
				<p class="mt-2 max-w-xs text-[12px] leading-snug text-foreground/55">
					Deine eigene KI, deine eigene Firma — und das, was du damit baust, gehört dir.
				</p>
			</div>

			<nav class="flex flex-col gap-2 text-[13px]" aria-label="Seiten">
				{#each nav as item (item.href)}
					<a href={item.href} class="text-foreground/65 transition-colors hover:text-foreground">
						{item.label}
					</a>
				{/each}
			</nav>

			<nav class="flex flex-col gap-2 text-[13px]" aria-label="Rechtliches">
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
			<p>© {year} avenCEO · avenOS — Own your life</p>
			<p>Alle Preise zzgl. der gesetzlichen Umsatzsteuer.</p>
		</div>
	</div>
</footer>
