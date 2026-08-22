<script lang="ts">
import { beamAvatarSvg, paletteFromCommaString } from '$lib/beam-avatar'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import SkillMarketplaceCard from '$lib/components/SkillMarketplaceCard.svelte'
import { type Lang, localeHref, pick } from '$lib/i18n'
import { home } from '$lib/i18n/home'
import { loadSkills } from '$lib/skills/loader'
import danielPhoto from '../../images/daniel.png'
import samuelPhoto from '../../images/samuel.jpg'

let { lang }: { lang: Lang } = $props()

const t = $derived(pick(home, lang))

/** A taste of the marketplace: the first six skills, the full list lives at /skills. */
const skillsPreview = $derived(loadSkills(lang).slice(0, 6))

const paletteKi = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')
</script>

<svelte:head>
	<title>{t.title}</title>
	<meta name="description" content={t.description}>
</svelte:head>

<!-- All {@html} below renders our own static copy from $lib/i18n/home.ts — never user content. -->
<div {lang} class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader {lang} />

	<section
		class="border-b border-border/35 bg-linear-to-b from-surface-raised via-background to-background px-5 py-24 sm:px-8 sm:py-32 md:py-40"
		aria-labelledby="home-hero-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<h1
				id="home-hero-heading"
				class="mx-auto max-w-3xl text-[clamp(1.75rem,5vw,2.75rem)] font-light leading-tight tracking-tight text-pretty text-foreground"
			>
				{t.hero.headingLine1}
				<span class="mt-1 block">{t.hero.headingLine2}</span>
			</h1>
			<div class="mx-auto mt-8 max-w-2xl">
				<p
					class="text-pretty text-[19px] font-normal leading-snug text-foreground/75 sm:text-[21px]"
				>
					{t.hero.leadBefore}
					<strong class="font-medium text-accent">{t.hero.leadStrong}</strong>
					{t.hero.leadAfter}
				</p>
			</div>
		</div>
	</section>

	<!-- The shift: the FOMO that is simply true — post-AGI touches everyone. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="shift-heading"
	>
		<div class="mx-auto max-w-4xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
					{t.shift.eyebrow}
				</p>
				<h2
					id="shift-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					{t.shift.heading}
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					{@html t.shift.bodyHtml}
				</p>
				<p
					class="mx-auto mt-6 max-w-xl text-pretty text-[19px] font-medium leading-snug text-foreground sm:text-[22px]"
				>
					{t.shift.question}
				</p>
			</div>

			<!-- The emotional fork: the same future, seen from both sides. -->
			<div class="mt-10 grid gap-4 sm:grid-cols-2">
				<div class="rounded-2xl bg-primary p-6 sm:p-7">
					<p class="text-[9px] font-bold uppercase tracking-[0.24em] text-primary-foreground/45">
						{t.shift.without.eyebrow}
					</p>
					<h3 class="mt-2 text-lg font-semibold tracking-tight text-primary-foreground sm:text-xl">
						{t.shift.without.title}
					</h3>
					<ul class="mt-4 space-y-2.5 text-[14px] leading-snug text-primary-foreground/72">
						{#each t.shift.without.items as item, i (i)}
							<li class="flex gap-2.5">
								<span
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/25"
									aria-hidden="true"
								></span>
								<span>{item}</span>
							</li>
						{/each}
					</ul>
					<p
						class="mt-5 border-t border-primary-foreground/15 pt-4 text-[1.25rem] font-light leading-snug text-primary-foreground sm:text-[1.4rem]"
					>
						{t.shift.without.closing}
					</p>
				</div>
				<div class="rounded-2xl border border-accent/45 bg-secondary p-6 sm:p-7">
					<p class="text-[9px] font-bold uppercase tracking-[0.24em] text-foreground/45">
						{t.shift.with.eyebrow}
					</p>
					<h3 class="mt-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
						{t.shift.with.title}
					</h3>
					<ul class="mt-4 space-y-2.5 text-[14px] leading-snug text-foreground/75">
						{#each t.shift.with.items as item, i (i)}
							<li class="flex gap-2.5">
								<span
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/30"
									aria-hidden="true"
								></span>
								<span>{item}</span>
							</li>
						{/each}
					</ul>
					<p
						class="mt-5 border-t border-foreground/10 pt-4 text-[1.25rem] font-light leading-snug text-foreground sm:text-[1.4rem]"
					>
						{t.shift.with.closing}
					</p>
				</div>
			</div>

			<p
				class="mx-auto mt-10 max-w-xl text-center text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				{t.shift.closingBefore}
				<strong class="font-sans font-semibold text-accent">{t.shift.closingStrong}</strong>
			</p>
		</div>
	</section>

	<!-- The thesis: the company of the future, named. -->
	<section
		class="border-b border-border/40 bg-linear-to-b from-surface-soft/70 to-transparent px-5 py-16 sm:px-8 sm:py-24"
		aria-labelledby="company-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
				{t.company.eyebrow}
			</p>
			<h2
				id="company-heading"
				class="mt-5 text-[clamp(1.75rem,5vw,2.75rem)] font-light leading-tight tracking-tight text-foreground"
			>
				{t.company.heading}
			</h2>
			<div
				class="mx-auto mt-8 max-w-2xl space-y-4 text-[15px] leading-relaxed text-foreground/72 sm:text-base"
			>
				{#each t.company.paragraphsHtml as paragraph, i (i)}
					<p class="text-pretty">{@html paragraph}</p>
				{/each}
			</div>
			<p
				class="mx-auto mt-9 max-w-xl border-t border-border/40 pt-7 text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				{t.company.closingLine1}
				<span class="mt-2 block">
					{t.company.closingLine2Before}
					<strong class="font-sans font-semibold text-foreground"
						>{t.company.closingLine2Strong}</strong
					>.
				</span>
			</p>
		</div>
	</section>

	<!-- The pitch in one picture: an Aven is something you OWN, and you end up
	     owning several. Three rungs, not prose — the ladder is the argument. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="own-heading"
	>
		<div class="mx-auto max-w-4xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">{t.own.eyebrow}</p>
				<h2
					id="own-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					{t.own.heading}
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					{t.own.lead}
				</p>
			</div>

			<ol class="mt-10 grid gap-4 sm:grid-cols-3">
				{#each t.own.rungs as rung (rung.title)}
					<li
						class="rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)]"
					>
						<p class="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">
							{rung.count}
						</p>
						<p class="mt-2 text-lg font-semibold tracking-tight text-foreground">{rung.title}</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/68">{rung.text}</p>
					</li>
				{/each}
			</ol>

			<p
				class="mx-auto mt-10 max-w-xl text-center text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				{t.own.closing}
			</p>
		</div>
	</section>

	<!-- The compounding engine as three steps: revenue → stakes → more stakes.
	     The percentages and the legal shape live on /pricing, where someone is
	     actually asking; here it is only the wheel and why it turns. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="compound-heading"
	>
		<div class="mx-auto max-w-4xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
					{t.compound.eyebrow}
				</p>
				<h2
					id="compound-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					{t.compound.heading}
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					{t.compound.lead}
				</p>
			</div>

			<ol class="mt-10 grid gap-3 sm:grid-cols-3">
				{#each t.compound.steps as step, i (i)}
					<li class="flex gap-3 rounded-2xl border border-border/50 bg-surface-card px-5 py-4">
						<span class="text-[13px] font-bold tabular-nums text-accent">{i + 1}</span>
						<span class="text-[14px] leading-snug text-foreground/78">{step}</span>
					</li>
				{/each}
			</ol>

			<p
				class="mx-auto mt-6 max-w-xl text-center text-[15px] leading-snug text-foreground/68 sm:text-base"
			>
				{@html t.compound.closingHtml}
			</p>

			<div class="mx-auto mt-10 max-w-2xl border-t border-border/40 pt-8 text-center">
				<p
					class="text-[1.125rem] font-light leading-snug tracking-tight text-pretty text-foreground sm:text-[1.3125rem]"
				>
					{t.compound.movement}
				</p>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-foreground/68">
					{@html t.compound.movementHtml}
				</p>
				<p class="mt-6">
					<a
						href="{localeHref(lang, '/pricing')}#avencoop"
						class="inline-flex min-h-11 items-center justify-center rounded-full border border-primary/45 px-8 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-soft"
					>
						{t.compound.link}
					</a>
				</p>
			</div>
		</div>
	</section>

	<section
		class="border-b border-border/40 bg-linear-to-b from-surface-soft/50 to-transparent px-5 py-9 sm:px-8 sm:py-11"
		id="founders"
	>
		<div class="mx-auto max-w-5xl">
			<header class="mx-auto max-w-2xl text-center">
				<p class="text-[9px] font-bold uppercase tracking-[0.26em] text-accent">
					{t.founders.eyebrow}
				</p>
				<h2
					class="mt-2 text-[clamp(1.5rem,4vw,2.15rem)] font-light leading-tight tracking-tight text-foreground/90"
				>
					{t.founders.heading}
				</h2>
				<p
					class="mx-auto mt-4 max-w-xl text-[13px] leading-relaxed text-foreground/67 sm:max-w-2xl sm:text-[15px] sm:leading-[1.52]"
				>
					{@html t.founders.introHtml}
				</p>
				<p
					class="mx-auto mt-3 max-w-xl text-[13px] leading-relaxed text-foreground/67 sm:max-w-2xl sm:text-[15px] sm:leading-[1.52]"
				>
					{@html t.founders.teamHtml}
				</p>
			</header>

			<div
				class="mx-auto mt-8 max-w-3xl rounded-2xl border border-foreground/8 bg-surface-raised px-4 py-5 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:px-6 sm:py-6"
			>
				<div
					class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1.2fr)] items-stretch gap-x-2 sm:gap-x-4"
				>
					<div class="flex min-w-0 flex-col items-center justify-start text-center">
						<div
							class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16"
						>
							<img
								src={samuelPhoto}
								alt={t.founders.samuel.alt}
								class="h-full w-full object-cover"
								width="64"
								height="64"
								decoding="async"
							>
						</div>
						<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/36">
							{t.founders.samuel.role}
						</p>
						<p
							class="mt-0.5 truncate text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px]"
						>
							{t.founders.samuel.name}
						</p>
						<p
							class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/52 sm:text-[10px]"
						>
							{t.founders.samuel.caption}
						</p>
					</div>
					<div
						class="flex w-6 min-w-[1.5rem] flex-col justify-center pb-10 sm:w-8 sm:pb-12"
						aria-hidden="true"
					>
						<span
							class="text-center text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
							>+</span
						>
					</div>
					<div class="flex min-w-0 flex-col items-center justify-start text-center">
						<div
							class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16"
						>
							<img
								src={danielPhoto}
								alt={t.founders.daniel.alt}
								class="h-full w-full object-cover"
								width="64"
								height="64"
								decoding="async"
							>
						</div>
						<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/36">
							{t.founders.daniel.role}
						</p>
						<p
							class="mt-0.5 truncate text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px]"
						>
							{t.founders.daniel.name}
						</p>
						<p
							class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/52 sm:text-[10px]"
						>
							{t.founders.daniel.caption}
						</p>
					</div>
					<div
						class="flex w-6 min-w-[1.5rem] flex-col justify-center pb-10 sm:w-8 sm:pb-12"
						aria-hidden="true"
					>
						<span
							class="text-center text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
							>→</span
						>
					</div>
					<div class="flex min-w-0 flex-col items-center justify-start text-center">
						<div
							class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
							aria-hidden="true"
						>
							{@html beamAvatarSvg('avenCEO', paletteKi, 64, 'fnd-k-ceo')}
						</div>
						<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40">
							{t.founders.ceo.role}
						</p>
						<p class="mt-0.5 text-[12px] font-bold tracking-[0.1em] text-accent sm:text-[13px]">
							{t.founders.ceo.name}
						</p>
						<p
							class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/50 sm:text-[10px]"
						>
							{t.founders.ceo.caption}
						</p>
					</div>
				</div>
				<p
					class="mt-4 border-t border-border/25 pt-3 text-center text-[10px] font-bold tracking-[0.2em] text-accent sm:text-[11px]"
				>
					{t.founders.sum}
				</p>
			</div>
		</div>
	</section>

	<!-- Skills preview: what an Aven can already do, straight from the marketplace. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="skills-preview-heading"
	>
		<div class="mx-auto max-w-5xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
					{t.skills.eyebrow}
				</p>
				<h2
					id="skills-preview-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					{t.skills.heading}
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					{t.skills.lead}
				</p>
			</div>

			<div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each skillsPreview as skill (skill.slug)}
					<SkillMarketplaceCard {skill} {lang} />
				{/each}
			</div>

			<p class="mt-8 text-center">
				<a
					href={localeHref(lang, '/skills')}
					class="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-foreground/60 transition-colors hover:text-foreground"
				>
					{t.skills.all}
				</a>
			</p>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div class="pb-6 text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
					{t.start.eyebrow}
				</p>
				<h2
					class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					{t.start.heading}
				</h2>
				<p class="mx-auto mt-3 max-w-lg text-[15px] leading-snug text-foreground/68 sm:text-base">
					{@html t.start.bodyHtml}
				</p>
			</div>
			<AvenIdCheckCta variant="banner" {lang} />
		</div>
	</section>

	<SiteFooter {lang} />
</div>
