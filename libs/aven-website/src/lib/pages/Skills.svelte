<script lang="ts">
import { browser } from '$app/environment'
import { page } from '$app/state'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import SkillMarketplaceCard from '$lib/components/SkillMarketplaceCard.svelte'
import { type Lang, localeHref, pick } from '$lib/i18n'
import { localizedPlan, priceLabel, vatNote } from '$lib/i18n/plans'
import { skills as messages } from '$lib/i18n/skills'
import { PLANS, type PlanId, planIncludes } from '$lib/pricing/plans'
import { loadSkills, loadSkillsByPlan, skillDetailHref, skillsIncludedIn } from '$lib/skills/loader'

let { lang }: { lang: Lang } = $props()

const t = $derived(pick(messages, lang).marketplace)
const skills = $derived(loadSkills(lang))
const byPlan = $derived(loadSkillsByPlan(lang))

/**
 * The marketplace is organized by PRODUCT, not by author: a buyer asks which
 * plan a skill comes with. avenFOUNDER carries every avenME skill, so
 * picking one shows exactly its skills; only avenCOOP also carries avenFOUNDER's.
 * `?plan=` lets the pricing
 * page link straight into the right selection.
 */
// Static site (prerendered): the query string only exists in the browser, never at build time.
const fromQuery = $derived(browser ? (page.url.searchParams.get('plan') as PlanId | null) : null)
let picked = $state<PlanId | null>(null)
const selected = $derived<PlanId>(
	picked ?? (fromQuery && PLANS.some((p) => p.id === fromQuery) ? fromQuery : 'avenceo')
)

const visibleSkills = $derived(skills.filter((s) => planIncludes(selected, s.plan)))
const visibleByPlan = $derived(
	byPlan.filter((g) => planIncludes(selected, g.plan.id) && g.skills.length > 0)
)
const selectedPlan = $derived(PLANS.find((p) => p.id === selected) ?? PLANS[0])
/** What this plan brings itself, versus what it inherits from below it. */
const ownCount = $derived(visibleSkills.filter((s) => s.plan === selected).length)
const inheritedCount = $derived(visibleSkills.length - ownCount)

const chainSteps = $derived(t.chain.steps)
</script>

<svelte:head>
	<title>{t.title}</title>
	<meta name="description" content={t.description}>
</svelte:head>

<div {lang} class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="skills" maxWidth="6xl" {lang} />

	<!-- Hero -->
	<section class="border-b border-border/40 px-5 py-24 sm:px-8 sm:py-32 md:py-40">
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
				{t.hero.eyebrow}
			</p>
			<h1
				class="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em] text-pretty leading-snug text-foreground sm:text-3xl md:text-[2.35rem] md:leading-[1.15]"
			>
				{t.hero.heading}
				<span
					class="mt-2 block text-[clamp(1.25rem,3.85vw,2.05rem)] font-light leading-[1.08] tracking-tight text-foreground/88"
				>
					{t.hero.subheading}
				</span>
			</h1>
			<p class="mx-auto mt-8 max-w-2xl text-[15px] leading-relaxed text-foreground/70 sm:text-base">
				{@html t.hero.paragraphHtml}
			</p>
		</div>
	</section>

	<!-- Marketplace: sidebar + featured + catalog -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
		<div class="mx-auto flex max-w-6xl flex-col gap-10 lg:flex-row lg:gap-12">
			<!-- Filters -->
			<aside class="lg:w-56 lg:shrink-0">
				<p class="text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/35">
					{t.filter.label}
				</p>
				<p class="mt-2 text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55">
					{t.filter.includedIn}
				</p>
				<p class="mt-1 text-[11px] leading-snug text-foreground/45">
					{t.filter.explainer}
				</p>
				<!-- Only plans that actually carry skills: avenID sat here forever
				     showing an empty catalogue, which is a filter that can only
				     disappoint. -->
				<div class="mt-4 space-y-2">
					{#each PLANS.filter((pl) => skillsIncludedIn(pl.id, lang).length > 0) as p (p.id)}
						{@const included = planIncludes(selected, p.id)}
						{@const isSelected = selected === p.id}
						<button
							type="button"
							onclick={() => {
								picked = p.id
							}}
							class="flex w-full items-start gap-3 rounded-xl border p-3 text-left ring-1 transition-colors {isSelected
								? 'border-accent/60 bg-accent/12 ring-accent/25'
								: included
									? 'border-border/45 bg-surface-raised hover:bg-surface-soft'
									: 'border-border/25 bg-surface-card opacity-55 hover:opacity-85'}"
						>
							<span
								class="mt-1 size-3.5 shrink-0 rounded-full border {included
									? 'border-accent bg-accent'
									: 'border-foreground/25'}"
								aria-hidden="true"
							></span>
							<span class="min-w-0 flex-1">
								<span class="flex items-baseline justify-between gap-2">
									<span class="text-[12px] font-bold tracking-[0.08em] text-foreground/80">
										{p.name}
									</span>
									<span class="shrink-0 text-[11px] font-semibold tabular-nums text-foreground/55">
										{priceLabel(p, lang)}
									</span>
								</span>
								<span class="mt-0.5 block text-[10px] leading-snug text-foreground/48">
									{localizedPlan(p, lang).role}
								</span>
							</span>
						</button>
					{/each}
				</div>
				<p class="mt-3 text-[10px] leading-snug text-foreground/42">{vatNote(lang)}</p>
				<p class="mt-3 text-[10px] font-semibold tabular-nums text-foreground/42">
					{t.filter.count(visibleSkills.length, skills.length)}
				</p>
				<a
					href={localeHref(lang, '/pricing')}
					class="mt-3 inline-flex text-[11px] font-semibold text-foreground/55 underline underline-offset-4 hover:text-foreground/80"
				>
					{t.filter.compare}
				</a>
			</aside>

			<div class="min-w-0 flex-1 space-y-12">
				{#if visibleByPlan.length > 1}
					<p
						class="rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-[13px] leading-snug text-foreground/75"
					>
						{t.inclusion(selectedPlan.name, visibleSkills.length, inheritedCount, ownCount)}
					</p>
				{/if}
				{#each visibleByPlan as group (group.plan.id)}
					<div>
						<div
							class="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border/30 pb-4"
						>
							<div>
								<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/38">
									{t.group.with(group.plan.name)}
								</p>
								<h2 class="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
									{localizedPlan(group.plan, lang).role}
								</h2>
								<p class="mt-1 text-[12px] text-foreground/52">
									{t.group.count(group.skills.length, priceLabel(group.plan, lang))}
								</p>
							</div>
							<a
								href={`${localeHref(lang, '/pricing')}#${group.plan.id}`}
								class="text-[12px] font-semibold text-foreground/55 underline underline-offset-4 hover:text-foreground/80"
							>
								{t.group.view(group.plan.name)}
							</a>
						</div>
						<div class="grid gap-4 md:grid-cols-2">
							{#each group.skills as skill (skill.slug)}
								<SkillMarketplaceCard {skill} {lang} />
							{/each}
						</div>
					</div>
				{:else}
					<p
						class="rounded-xl border border-border/35 bg-surface-card px-4 py-6 text-center text-[14px] text-foreground/55"
					>
						{t.empty}
					</p>
				{/each}
			</div>
		</div>
	</section>

	<!-- Chain visualization -->
	<section
		class="border-b border-border/40 bg-gradient-to-b from-transparent via-white/20 to-transparent px-5 py-14 sm:px-8 sm:py-20"
	>
		<div class="mx-auto max-w-4xl">
			<div class="text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
					{t.chain.eyebrow}
				</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					{t.chain.heading}
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
					{t.chain.paragraph}
				</p>
			</div>

			<div
				class="mt-10 flex flex-col items-center gap-2 sm:flex-row sm:items-stretch sm:justify-center"
			>
				{#each chainSteps as step, i (step.slug)}
					<a
						href={skillDetailHref(step.slug, lang)}
						class="group flex min-w-0 flex-col items-center rounded-xl border border-border/35 bg-surface-raised px-4 py-4 text-center transition-colors hover:border-border/65 hover:bg-surface-soft sm:w-36"
					>
						<p
							class="text-[10px] font-bold tracking-[0.1em] text-foreground/70 group-hover:text-foreground/90"
						>
							{step.label}
						</p>
						<p class="mt-1 text-[11px] leading-snug text-foreground/50">{step.description}</p>
					</a>
					{#if i < chainSteps.length - 1}
						<div
							class="flex items-center justify-center text-foreground/30 sm:self-center"
							aria-hidden="true"
						>
							<span class="text-lg sm:text-xl">→</span>
						</div>
					{/if}
				{/each}
			</div>

			<div
				class="mx-auto mt-6 max-w-sm rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-center ring-1 ring-accent/20"
			>
				<p class="text-[9px] font-bold uppercase tracking-[0.22em] text-accent">
					{t.chain.hitlLabel}
				</p>
				<a
					href={skillDetailHref('human-reviewer', lang)}
					class="mt-1 block text-[12px] font-bold tracking-[0.08em] text-foreground/75 hover:text-foreground/95"
				>
					human-reviewer
				</a>
				<p class="mt-1 text-[11px] text-foreground/52">
					{t.chain.hitlNote}
				</p>
			</div>
		</div>
	</section>

	<!-- Bundled-pricing band -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
				{t.pricing.eyebrow}
			</p>
			<h2 class="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
				{t.pricing.heading(skills.length)}
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
				{t.pricing.paragraph}
			</p>
			<div class="mt-6">
				<a
					href={localeHref(lang, '/pricing')}
					class="inline-flex min-h-11 items-center justify-center rounded-full border border-border/60 bg-surface-raised px-7 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-soft"
				>
					{t.pricing.cta}
				</a>
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<AvenIdCheckCta variant="banner" {lang} />
		</div>
	</section>

	<SiteFooter {lang} />
</div>
