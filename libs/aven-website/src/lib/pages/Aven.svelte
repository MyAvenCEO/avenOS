<script lang="ts">
import { avensOfKind, type LiveAven } from '$lib/avens'
import { beamAvatarSvg, paletteFromCommaString } from '$lib/beam-avatar'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import { type Lang, localeHref, pick } from '$lib/i18n'
import { aven } from '$lib/i18n/aven'
import { plan } from '$lib/pricing/plans'
import { loadSkill, skillDetailHref, skillLabel } from '$lib/skills/loader'

let { lang }: { lang: Lang } = $props()

const t = $derived(pick(aven, lang))

const paletteCompany = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')
const palettePerson = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')

const groups = $derived([
	{ kind: 'company' as const, ...t.company, avens: avensOfKind('company') },
	{ kind: 'person' as const, ...t.person, avens: avensOfKind('person') }
])

function skillsOf(a: LiveAven) {
	return a.skills
		.map((slug) => ({ slug, soon: loadSkill(slug, lang)?.comingSoon ?? false }))
		.sort((x, y) => Number(x.soon) - Number(y.soon))
}
</script>

<svelte:head>
	<title>{t.title}</title>
	<meta name="description" content={t.description}>
</svelte:head>

<!-- Every {@html} below renders our own static copy from $lib/i18n — never user content. -->
<div {lang} class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="aven" maxWidth="6xl" {lang} />

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

	{#each groups as group (group.kind)}
		<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
			<div class="mx-auto max-w-6xl">
				<header class="max-w-2xl">
					<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">{group.label}</p>
					<p class="mt-2 text-[15px] leading-snug text-foreground/65">{group.lead}</p>
				</header>
				<div class="mt-6 grid gap-4 lg:grid-cols-2">
					{#each group.avens as a (a.slug)}
						{@const runsOn = plan(a.plan)}
						<article
							class="flex min-w-0 flex-col rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
						>
							<div class="flex items-start gap-4">
								<div
									class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background [&>svg]:block [&>svg]:size-full"
									aria-hidden="true"
								>
									{@html beamAvatarSvg(
										a.name,
										a.kind === 'company' ? paletteCompany : palettePerson,
										56,
										`aven-${a.slug}`
									)}
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-baseline justify-between gap-2">
										<p class="text-xl font-semibold tracking-tight text-foreground">{a.name}</p>
										<span
											class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] {a.kind ===
											'company'
												? 'bg-accent/20 text-accent'
												: 'bg-quiet/15 text-quiet-ink'}"
										>
											{t.kind[a.kind]}
										</span>
									</div>
									<p class="mt-0.5 text-[13px] text-foreground/55">
										<span class="font-medium text-foreground/75">{a.slug}</span>.aven.ceo
									</p>
									<p class="mt-1 text-[12px] text-foreground/55">
										{t.holder}
										<span class="font-medium text-foreground/75">{a.holder}</span>
										<span class="text-foreground/35"> · </span>
										{t.runsOn}
										<a
											href={`${localeHref(lang, '/pricing')}#${runsOn.id}`}
											class="font-medium text-foreground/75 underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground/60"
										>
											{runsOn.name}
										</a>
									</p>
								</div>
							</div>

							<div class="mt-5 border-t border-border/50 pt-4">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
									{t.services}
								</p>
								<ul class="mt-2 space-y-1.5 text-[13px] leading-snug text-foreground/75">
									{#each t.doing[a.slug] ?? [] as line (line)}
										<li class="flex gap-2">
											<span
												aria-hidden="true"
												class="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
											></span>
											<span>{line}</span>
										</li>
									{/each}
								</ul>
							</div>

							<div class="mt-4 border-t border-border/50 pt-4">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
									{t.skills}
								</p>
								<ul class="mt-2 flex flex-wrap gap-1.5">
									{#each skillsOf(a) as s (s.slug)}
										<li>
											<a
												href={skillDetailHref(s.slug, lang)}
												class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors {s.soon
													? 'border-dashed border-quiet/45 text-quiet-ink hover:border-quiet/70'
													: 'border-border/50 bg-surface-card text-foreground/80 hover:border-border/80'}"
											>
												{skillLabel(s.slug)}
												<span
													class="text-[9px] font-semibold uppercase tracking-[0.1em] {s.soon
														? 'text-quiet-ink/70'
														: 'text-accent'}"
												>
													{s.soon ? t.soon : t.live}
												</span>
											</a>
										</li>
									{/each}
								</ul>
							</div>
						</article>
					{/each}
				</div>
			</div>
		</section>
	{/each}

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<p class="mb-4 text-center text-[15px] font-medium text-foreground/75">{t.cta}</p>
			<AvenIdCheckCta variant="banner" {lang} />
		</div>
	</section>

	<SiteFooter {lang} />
</div>
