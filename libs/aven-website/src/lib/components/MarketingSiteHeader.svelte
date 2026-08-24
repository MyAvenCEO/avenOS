<script lang="ts">
import { page } from '$app/state'
import SocialIcon from '$lib/components/SocialIcon.svelte'
import { type Lang, localeHref, pick, switchLangHref } from '$lib/i18n'
import { common } from '$lib/i18n/common'
import { idFunnelHref } from '$lib/id-service'
import { SOCIAL_PROFILES } from '$lib/social'

type NavActive = 'skills' | 'avens' | 'pricing'

let {
	active = null,
	maxWidth = '5xl',
	lang = 'de'
}: {
	active?: NavActive | null
	maxWidth?: '5xl' | '6xl'
	lang?: Lang
} = $props()

const t = $derived(pick(common, lang))
const maxW = maxWidth === '6xl' ? 'max-w-6xl' : 'max-w-5xl'

function linkCls(isActive: boolean) {
	return isActive
		? 'opacity-100 transition-opacity'
		: 'opacity-70 transition-opacity hover:opacity-100'
}

/** The same page in the other language — prerendered, so the pathname is known at build time. */
const otherHref = $derived(switchLangHref(lang, page.url.pathname))
</script>

<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
	<!-- Below lg (phone + tablet): four centered lines — logo · social icons · nav+DE|EN · CTA. lg+: one row. -->
	<div
		class="mx-auto flex {maxW} flex-col items-center gap-y-3 px-5 py-5 lg:flex-row lg:flex-wrap lg:justify-between lg:gap-x-10 lg:gap-y-2 lg:px-8"
	>
		<div class="flex flex-col items-center gap-3 lg:flex-row lg:gap-4">
			<a href={localeHref(lang, '/')} class="flex items-center gap-2.5">
				<img src="/aven-logo.svg" alt="" class="size-7 shrink-0" width="28" height="28">
				<span class="text-[17px] font-semibold tracking-tight text-foreground">avenCEO</span>
			</a>
			<span class="flex items-center gap-4 lg:gap-3" aria-label={t.footer.socialLabel}>
				{#each SOCIAL_PROFILES as profile (profile.href)}
					<a
						href={profile.href}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={profile.name}
						class="text-foreground/60 transition-colors hover:text-foreground"
					>
						<SocialIcon {profile} class="size-5 lg:size-4" />
					</a>
				{/each}
			</span>
		</div>
		<nav
			class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.12em]"
		>
			<a href={localeHref(lang, '/skills')} class={linkCls(active === 'skills')}>{t.nav.skills}</a>
			<a href={localeHref(lang, '/avens')} class={linkCls(active === 'avens')}>{t.nav.avens}</a>
			<a href={localeHref(lang, '/pricing')} class={linkCls(active === 'pricing')}>
				{t.nav.pricing}
			</a>
			<!-- Below lg the CTA takes its own full-width line so DE|EN shares the row with the nav links. -->
			<span class="order-last flex w-full justify-center lg:order-none lg:w-auto">
				<a
					href={idFunnelHref()}
					class="rounded-full bg-primary px-4 py-1.5 normal-case font-semibold text-primary-foreground transition-opacity hover:opacity-90"
				>
					{t.nav.cta}
				</a>
			</span>
			<!-- DE | EN: the current language is the solid one, the other is the link. -->
			<span class="flex items-center gap-1.5 tabular-nums" aria-label={t.switchLabel}>
				<a
					href={lang === 'de' ? page.url.pathname : otherHref}
					hreflang="de"
					aria-current={lang === 'de' ? 'true' : undefined}
					class={lang === 'de' ? 'opacity-100' : 'opacity-50 transition-opacity hover:opacity-100'}
				>
					DE
				</a>
				<span aria-hidden="true" class="opacity-30">|</span>
				<a
					href={lang === 'en' ? page.url.pathname : otherHref}
					hreflang="en"
					aria-current={lang === 'en' ? 'true' : undefined}
					class={lang === 'en' ? 'opacity-100' : 'opacity-50 transition-opacity hover:opacity-100'}
				>
					EN
				</a>
			</span>
		</nav>
	</div>
</header>
