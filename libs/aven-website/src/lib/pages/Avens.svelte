<script lang="ts">
import { avensOfKind, type LiveAven } from '$lib/avens'
import { beamAvatarSvg, paletteFromCommaString } from '$lib/beam-avatar'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import { type Lang, pick } from '$lib/i18n'
import { avens } from '$lib/i18n/avens'

let { lang }: { lang: Lang } = $props()

const t = $derived(pick(avens, lang))

const paletteCompany = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')
const palettePerson = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')

const companies = avensOfKind('company')
const people = avensOfKind('person')

/** The handle is the address — the whole point of a registry. */
function handle(a: LiveAven) {
	return `${a.slug}.aven.ceo`
}
</script>

<svelte:head>
	<title>{t.title}</title>
	<meta name="description" content={t.description}>
</svelte:head>

<!-- The {@html} below renders our own static copy from $lib/i18n — never user content. -->
<div {lang} class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="avens" maxWidth="6xl" {lang} />

	<section class="border-b border-border/40 px-5 py-20 sm:px-8 sm:py-28">
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{t.eyebrow}</p>
			<h1
				class="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em] text-pretty leading-snug text-foreground sm:text-3xl md:text-[2.35rem] md:leading-[1.15]"
			>
				{t.heading}
			</h1>
			<p class="mx-auto mt-6 max-w-2xl text-[15px] leading-relaxed text-foreground/70 sm:text-base">
				{@html t.introHtml}
			</p>
		</div>
	</section>

	<!-- Company Aven: what the company is FOR, and what it runs. -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
		<div class="mx-auto max-w-6xl">
			<header class="max-w-2xl">
				<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
					{t.company.label}
				</p>
				<p class="mt-2 text-[15px] leading-snug text-foreground/65">{t.company.lead}</p>
			</header>

			<div class="mt-6 grid gap-4 lg:grid-cols-2">
				{#each companies as a (a.slug)}
					{@const profile = t.companies[a.slug]}
					<article
						class="flex min-w-0 flex-col rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>
						<div class="flex items-start gap-4">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg(a.name, paletteCompany, 56, `aven-${a.slug}`)}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-baseline justify-between gap-2">
									<p class="text-xl font-semibold tracking-tight text-foreground">{a.name}</p>
									<span
										class="rounded-full bg-accent/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent"
									>
										{t.kind.company}
									</span>
								</div>
								<p class="mt-0.5 text-[13px] text-foreground/55">
									<span class="font-medium text-foreground/75">{a.slug}</span>.aven.ceo
								</p>
								<p class="mt-1 text-[12px] text-foreground/55">
									{t.behind}
									<span class="font-medium text-foreground/75">{a.holder}</span>
								</p>
							</div>
						</div>

						{#if a.link}
							<p class="mt-3 text-[12px]">
								<a
									href={a.link.href}
									target="_blank"
									rel="noopener noreferrer"
									class="font-medium text-foreground/70 underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground/60"
								>
									{a.link.label}
									↗
								</a>
							</p>
						{/if}

						{#if profile}
							<div class="mt-5 border-t border-border/50 pt-4">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
									{t.mission}
								</p>
								<p class="mt-2 text-[14px] leading-snug text-foreground/80">{profile.mission}</p>
							</div>
						{/if}
					</article>
				{/each}
			</div>
		</div>
	</section>

	<!-- Personal Aven: a registry line, nothing more. A personal Aven is private. -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
		<div class="mx-auto max-w-6xl">
			<header class="max-w-2xl">
				<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
					{t.person.label}
				</p>
				<p class="mt-2 text-[15px] leading-snug text-foreground/65">{t.person.lead}</p>
				<p class="mt-1 text-[12px] leading-snug text-foreground/45">{t.activationNote}</p>
			</header>

			<ul
				class="mt-6 divide-y divide-border/50 overflow-hidden rounded-2xl border border-foreground/8 bg-surface-raised"
			>
				{#each people as a (a.slug)}
					<li class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
						<div
							class="size-10 shrink-0 overflow-hidden rounded-full ring-2 ring-background [&>svg]:block [&>svg]:size-full"
							aria-hidden="true"
						>
							{@html beamAvatarSvg(a.name, palettePerson, 40, `aven-${a.slug}`)}
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-[15px] font-semibold tracking-tight text-foreground">{a.name}</p>
							<p class="text-[12px] text-foreground/50">{handle(a)}</p>
							{#if t.bios[a.slug] || a.link}
								<p class="mt-1 max-w-xl text-[12px] leading-snug text-foreground/60">
									{#if t.bios[a.slug]}
										{t.bios[a.slug]}
									{/if}
									{#if a.link}
										<a
											href={a.link.href}
											target="_blank"
											rel="noopener noreferrer"
											class="font-medium text-foreground/70 underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground/60"
										>
											{a.link.label}
											↗
										</a>
									{/if}
								</p>
							{/if}
						</div>
						<p class="ml-auto text-right text-[12px] leading-snug text-foreground/55">
							{t.behind}
							<span class="font-medium text-foreground/75">{a.holder}</span>
							{#if a.worksOn}
								<span class="block text-foreground/45">{t.worksOn} {a.worksOn}</span>
							{/if}
						</p>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<p class="mb-4 text-center text-[15px] font-medium text-foreground/75">{t.cta}</p>
			<AvenIdCheckCta variant="banner" {lang} />
		</div>
	</section>

	<SiteFooter {lang} />
</div>
