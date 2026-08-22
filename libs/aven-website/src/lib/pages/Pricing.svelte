<svelte:head>
	<title>{t.title}</title>
	<meta name="description" content={t.description}>
</svelte:head>

<script lang="ts">
import { browser } from '$app/environment'
import { page } from '$app/stores'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import { type Lang, localeHref, pick } from '$lib/i18n'
import { ctaLabel, localizedPlan, perLabel, priceSuffix, vatNote } from '$lib/i18n/plans'
import { pricing } from '$lib/i18n/pricing'
import { idFunnelHref } from '$lib/id-service'
import {
	ctaHref,
	euro,
	PLANS,
	type Plan,
	type PlanId,
	plan,
	totalSharePct
} from '$lib/pricing/plans'
import { loadSkill, skillDetailHref, skillLabel, skillsIncludedIn } from '$lib/skills/loader'

let { lang }: { lang: Lang } = $props()

const t = $derived(pick(pricing, lang))

const openSourceGithubHref = 'https://github.com/jaensen/avenOS'

/** avenID is the door, not a product in the grid — it gets its own band. */
const avenId = $derived(localizedPlan(plan('avenid'), lang))
/** The two Aven: one per human, one per company. Side by side, not stacked. */
const products = $derived(
	PLANS.filter((p) => p.id === 'avenme' || p.id === 'avenceo').map((p) => localizedPlan(p, lang))
)
/** avenCOOP is a relationship, not a third column — its own band below. */
const coop = $derived(localizedPlan(plan('avencoop'), lang))
const coopSkillCount = $derived(skillsIncludedIn(coop.id, lang).length)

/** A card shows at most this many skills; the rest sit behind "see all". */
const SKILL_CAP = 7

type SkillFeature = { skill: string; label: string }

/**
 * The skills a plan carries, live ones first: its own, plus — along the
 * skill cascade — everything from the plans it includes.
 */
function skillFeatures(p: Plan): SkillFeature[] {
	const cascade: PlanId[] =
		p.id === 'avencoop' ? ['avenceo', 'avenme'] : p.id === 'avenceo' ? ['avenme'] : []
	return [...p.features, ...cascade.flatMap((id) => localizedPlan(plan(id), lang).features)]
		.filter((f): f is SkillFeature => typeof f !== 'string' && 'skill' in f)
		.sort(
			(a, b) =>
				Number(loadSkill(a.skill, lang)?.comingSoon ?? false) -
				Number(loadSkill(b.skill, lang)?.comingSoon ?? false)
		)
}

// Static site (prerendered): the query string only exists in the browser, never at build time.
const claimedName = $derived(browser ? ($page.url.searchParams.get('name') ?? '') : '')
</script>

{#snippet skillList(items: SkillFeature[])}
	<ul class="mt-2 space-y-1.5 text-[13px] leading-snug">
		{#each items.slice(0, SKILL_CAP) as feature (feature.skill)}
			{@const soon = loadSkill(feature.skill, lang)?.comingSoon}
			<li class={soon ? 'opacity-70' : ''}>
				<a
					href={skillDetailHref(feature.skill, lang)}
					class="font-medium underline underline-offset-4 transition-colors {soon
						? 'text-quiet-ink decoration-dashed decoration-quiet/40 hover:decoration-quiet/70'
						: 'text-foreground decoration-foreground/25 hover:decoration-foreground/60'}"
				>
					{skillLabel(feature.skill)}
				</a>
				{#if soon}
					<span
						class="ml-1 rounded-full border border-quiet/45 bg-quiet/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-quiet-ink"
						>{t.soon}</span
					>
				{/if}
				<span class={soon ? 'text-foreground/45' : 'text-foreground/55'}>· {feature.label}</span>
			</li>
		{/each}
	</ul>
{/snippet}

<div {lang} class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="pricing" maxWidth="6xl" {lang} />

	<section
		id="pricing-plans"
		class="scroll-mt-28 border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16"
	>
		<div class="mx-auto max-w-6xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{t.eyebrow}</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					{t.heading}
				</h2>
				<!-- {@html}: our own static copy, carries <strong> emphasis. -->
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
					{@html t.introHtml}
				</p>
				<p class="mx-auto mt-4 max-w-xl text-[14px] leading-snug text-foreground/55">
					{@html t.shareHtml}
				</p>
			</div>

			<!-- avenID: the door. One line, one price, the things you get. -->
			<div
				id={avenId.id}
				class="mt-12 scroll-mt-28 rounded-2xl border border-accent/45 bg-surface-card p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7"
			>
				{#if claimedName}
					<p class="mb-5 text-center text-[13px] text-foreground/70">
						{t.yourChoice}
						<strong class="font-semibold text-accent">{claimedName}</strong>.aven.ceo —
						{t.availability}
					</p>
				{/if}
				<div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
					<div class="lg:w-64 lg:shrink-0">
						<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
							{t.idEyebrow}
						</p>
						<p class="mt-1 text-xl font-semibold tracking-tight text-foreground">{avenId.name}</p>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{avenId.role}</p>
						<p class="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
							{euro(avenId.eurPrice)}&nbsp;€
							<span class="text-[13px] font-medium text-foreground/55"
								>{priceSuffix(avenId, lang)}</span
							>
						</p>
					</div>
					<ul
						class="grid flex-1 gap-2 text-[13px] leading-snug text-foreground/75 sm:grid-cols-2 lg:border-l lg:border-border/50 lg:pl-10"
					>
						{#each avenId.features as feature (feature)}
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
								></span>
								<span>{feature}</span>
							</li>
						{/each}
					</ul>
					<div class="lg:shrink-0">
						<a
							href={claimedName
								? idFunnelHref('avenid', claimedName)
								: ctaHref(avenId)}
							class="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 lg:w-auto"
						>
							{ctaLabel(avenId, lang)}
						</a>
					</div>
				</div>
			</div>

			<!-- The two Aven, 50/50. -->
			<div class="mt-6 grid gap-4 lg:grid-cols-2 lg:gap-5">
				{#each products as p (p.id)}
					{@const skillCount = skillsIncludedIn(p.id, lang).length}
					{@const plain = p.features.filter((f) => typeof f === 'string' || 'href' in f)}
					{@const skills = skillFeatures(p)}
					<div
						id={p.id}
						class="flex min-w-0 scroll-mt-28 flex-col rounded-2xl p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {p.highlight
							? 'border-2 border-accent/60 bg-surface-raised'
							: 'border border-foreground/8 bg-surface-raised'}"
					>
						<div class="flex items-baseline justify-between gap-2">
							<!-- No `uppercase`: the brand is spelled avenME, not AVENME. -->
							<p class="text-xl font-semibold tracking-tight text-foreground">{p.name}</p>
							{#if perLabel(p, lang)}
								<span
									class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] {p.highlight
										? 'bg-accent/20 text-accent'
										: 'bg-quiet/15 text-quiet-ink'}"
								>
									{perLabel(p, lang)}
								</span>
							{/if}
						</div>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{p.role}</p>

						<!-- The monthly price stands alone. What comes off the revenue is a
						     different question, so it gets its own block rather than hanging
						     off the right edge of the price. -->
						<div class="mt-5 border-t border-border/50 pt-4 text-center">
							<p class="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
								{euro(p.eurPrice)}&nbsp;€<span class="text-base font-medium text-foreground/55"
									>{priceSuffix(p, lang)}</span
								>
							</p>
						</div>

						{#if totalSharePct(p) > 0}
							<div class="mt-4 border-t border-border/50 pt-4 text-center">
								<p class="text-[13px] font-medium text-foreground/75">
									{t.revenueShare(totalSharePct(p))}
								</p>
								<!-- The split is the whole point: half is a price, half buys you shares —
								     two equal boxes, so the reader sees two halves, not one number. -->
								<dl
									class="mt-3 grid grid-cols-2 divide-x divide-border/50 rounded-xl border border-border/50 bg-surface-card text-center"
								>
									<div class="px-3 py-2.5">
										<dt class="text-base font-semibold tabular-nums text-foreground/80">
											{p.platformFeePct}&nbsp;%
										</dt>
										<dd class="mt-0.5 text-[11px] font-medium text-foreground/70">{t.platform}</dd>
										<dd class="text-[10px] leading-snug text-foreground/45">{t.inclFees}</dd>
									</div>
									<div class="px-3 py-2.5">
										<dt class="text-base font-semibold tabular-nums text-accent">
											{p.reinvestPct}&nbsp;%
										</dt>
										<dd class="mt-0.5 text-[11px] font-medium text-accent">{t.reinvest}</dd>
										<dd class="text-[10px] leading-snug text-foreground/45">{t.reinvestInto}</dd>
									</div>
								</dl>
								{#if p.equitySharePct}
									<p class="mt-3 text-[12px] font-medium text-foreground/70">
										{t.equity(p.equitySharePct)}
									</p>
								{/if}
							</div>
						{/if}

						<ul
							class="mt-4 flex-1 space-y-2 border-t border-border/50 pt-4 text-left text-[13px] leading-snug text-foreground/75"
						>
							<!-- Not "Alles aus …": nothing is inherited. Say who it is for instead. -->
							<li class="flex gap-2 font-medium text-foreground/85">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full {p.highlight
										? 'bg-accent'
										: 'bg-foreground/25'}"
								></span>
								<span>
									{#if p.per === 'company'}
										{t.onePerCompany}
									{:else}
										{t.onePerPerson}
									{/if}
								</span>
							</li>
							{#each plain as feature (typeof feature === 'string' ? feature : feature.label)}
								<li class="flex gap-2">
									<span
										aria-hidden="true"
										class="mt-1.5 size-1.5 shrink-0 rounded-full {p.highlight
											? 'bg-accent'
											: 'bg-foreground/25'}"
									></span>
									{#if typeof feature === 'string'}
										<span>{feature}</span>
									{:else}
										<span>
											<a
												href={feature.href}
												target="_blank"
												rel="noopener noreferrer"
												class="underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground/60"
											>
												{feature.label}
												→
											</a>
										</span>
									{/if}
								</li>
							{/each}
						</ul>

						<!-- Skills are their own category, not more bullets: a feature is
						     something the tier does, a skill is a thing you can go read. -->
						{#if skills.length > 0 || skillCount > 0}
							<div class="mt-4 border-t border-border/50 pt-4 text-left">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
									{t.skills}
								</p>
								{@render skillList(skills)}
								{#if skillCount > 0}
									<p class="mt-2 text-[12px] text-foreground/50">
										<a
											href={`${localeHref(lang, '/skills')}?plan=${p.id}`}
											class="underline underline-offset-4 hover:text-foreground/75"
										>
											{t.allSkills(skillCount)}
										</a>
									</p>
								{/if}
							</div>
						{/if}

						{#if p.runtime}
							<div
								class="mt-4 rounded-xl border border-border/60 bg-surface-card px-4 py-3 text-left"
							>
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
									{t.runtime}
								</p>
								<p class="mt-1 text-[13px] font-medium leading-snug text-foreground/85">
									{t.runtimeHours(p.runtime.hoursPerDay)}
									<span class="font-normal text-foreground/55">{t.fairUse}</span>
								</p>
								<p class="mt-0.5 text-[12px] leading-snug text-foreground/55">
									{t.extraMinute(p.runtime.centsPerExtraMinute)}
								</p>
							</div>
						{/if}

						<div class="mt-5 lg:mt-auto lg:pt-5">
							<a
								href={ctaHref(p)}
								class="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
							>
								{ctaLabel(p, lang)}
							</a>
							<p class="mt-2 text-center text-[11px] leading-snug text-foreground/50">
								{t.bundleNote(avenId.name, euro(avenId.eurPrice), p.per)}
							</p>
						</div>

						{#if p.referralPct}
							<p class="mt-4 text-center">
								<span class="text-xl font-semibold tracking-tight text-accent">
									{t.referral(p.referralPct)}
								</span>
								<span class="mt-1 block text-[12px] leading-snug text-foreground/55">
									{t.referralNote}
								</span>
							</p>
						{/if}
					</div>
				{/each}
			</div>

			<!-- avenCOOP: a relationship, full width. Includes the company's avenFOUNDER. -->
			<div
				id={coop.id}
				class="mt-6 scroll-mt-28 rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7 lg:p-8"
			>
				<div class="grid gap-8 lg:grid-cols-[17rem_1fr] lg:gap-12">
					<!-- Left: who it is, what it costs, what it takes. -->
					<div class="border-b border-border/50 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-12">
						<span
							class="inline-block rounded-full bg-quiet/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-quiet-ink"
						>
							{t.applyOnly}
						</span>
						<p class="mt-3 text-xl font-semibold tracking-tight text-foreground">{coop.name}</p>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{coop.role}</p>

						<div class="mt-5 border-t border-border/50 pt-4">
							<p class="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
								{euro(coop.eurPrice)}&nbsp;€
							</p>
							<p class="mt-0.5 text-[13px] font-medium text-foreground/55">
								{priceSuffix(coop, lang)}
							</p>
						</div>

						<div class="mt-4 border-t border-border/50 pt-4">
							<p class="text-[13px] font-medium text-foreground/75">
								{t.revenueShare(totalSharePct(coop))}
							</p>
							<dl
								class="mt-3 grid grid-cols-2 divide-x divide-border/50 rounded-xl border border-border/50 bg-surface-card text-center"
							>
								<div class="px-3 py-2.5">
									<dt class="text-base font-semibold tabular-nums text-foreground/80">
										{coop.platformFeePct}&nbsp;%
									</dt>
									<dd class="mt-0.5 text-[11px] font-medium text-foreground/70">{t.platform}</dd>
									<dd class="text-[10px] leading-snug text-foreground/45">{t.inclFees}</dd>
								</div>
								<div class="px-3 py-2.5">
									<dt class="text-base font-semibold tabular-nums text-accent">
										{coop.reinvestPct}&nbsp;%
									</dt>
									<dd class="mt-0.5 text-[11px] font-medium text-accent">{t.reinvest}</dd>
									<dd class="text-[10px] leading-snug text-foreground/45">{t.reinvestInto}</dd>
								</div>
							</dl>
							{#if coop.equitySharePct}
								<p class="mt-3 text-[12px] font-medium text-foreground/70">
									{t.equity(coop.equitySharePct)}
								</p>
							{/if}
						</div>
					</div>

					<!-- Right: what you get (bullets) | skills + runtime, then the decision. -->
					<div class="flex min-w-0 flex-col">
						<div class="grid gap-8 sm:grid-cols-[1fr_16rem] sm:gap-10">
							<ul class="space-y-3 text-[13px] leading-snug text-foreground/75">
								{#each coop.features as feature (typeof feature === 'string' ? feature : feature.label)}
									<li class="flex gap-2">
										<span
											aria-hidden="true"
											class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
										></span>
										{#if typeof feature === 'string'}
											<span>{feature}</span>
										{:else if 'href' in feature}
											<span>
												<a
													href={feature.href}
													target="_blank"
													rel="noopener noreferrer"
													class="underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-foreground/60"
												>
													{feature.label}
													→
												</a>
											</span>
										{:else}
											<span>
												<a
													href={skillDetailHref(feature.skill, lang)}
													class="font-medium underline underline-offset-4"
												>
													{skillLabel(feature.skill)}
												</a>
												<span class="text-foreground/55">· {feature.label}</span>
											</span>
										{/if}
									</li>
								{/each}
							</ul>

							<div>
								{#if coopSkillCount > 0}
									<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
										{t.skills}
									</p>
									{@render skillList(skillFeatures(coop))}
									<p class="mt-2 text-[12px] text-foreground/50">
										<a
											href={`${localeHref(lang, '/skills')}?plan=${coop.id}`}
											class="underline underline-offset-4 hover:text-foreground/75"
										>
											{t.allSkills(coopSkillCount)}
										</a>
									</p>
								{/if}
								{#if coop.runtime}
									<div
										class="mt-4 rounded-xl border border-border/60 bg-surface-card px-4 py-3 text-left"
									>
										<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">
											{t.runtime}
										</p>
										<p class="mt-1 text-[13px] font-medium leading-snug text-foreground/85">
											{t.runtimeHours(coop.runtime.hoursPerDay)}
											<span class="font-normal text-foreground/55">{t.fairUse}</span>
										</p>
										<p class="mt-0.5 text-[12px] leading-snug text-foreground/55">
											{t.extraMinute(coop.runtime.centsPerExtraMinute)}
										</p>
									</div>
								{/if}
							</div>
						</div>

						<div
							class="mt-6 flex flex-col gap-4 border-t border-border/50 pt-6 sm:flex-row sm:items-center sm:justify-between"
						>
							{#if coop.referralPct}
								<p class="max-w-xs">
									<span class="text-xl font-semibold tracking-tight text-accent">
										{t.referral(coop.referralPct)}
									</span>
									<span class="mt-1 block text-[12px] leading-snug text-foreground/55">
										{t.referralNote}
									</span>
								</p>
							{/if}
							<a
								href={ctaHref(coop)}
								class="inline-flex min-h-11 items-center justify-center rounded-full border border-primary/45 px-10 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-soft"
							>
								{ctaLabel(coop, lang)}
							</a>
						</div>
					</div>
				</div>
			</div>

			<p class="mt-6 text-center text-[12px] text-foreground/50">{vatNote(lang)}</p>

			<div
				class="mx-auto mt-12 max-w-6xl rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7 lg:p-8"
			>
				<div class="grid gap-10 lg:grid-cols-[minmax(13.5rem,17rem)_1fr] lg:gap-14 lg:items-start">
					<div
						class="shrink-0 border-b border-border/50 pb-8 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-10"
					>
						<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
							{t.os.eyebrow}
						</p>
						<h3 class="mt-2 text-lg font-semibold text-foreground sm:text-xl">{t.os.title}</h3>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">
							{t.os.subtitle}
						</p>
						<p class="mt-1 text-lg font-semibold tabular-nums text-foreground">0&nbsp;€</p>
						<ul
							class="mt-5 space-y-2 border-t border-border/50 pt-5 text-[13px] leading-snug text-foreground/72"
							aria-label={t.os.listLabel}
						>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span><span>{t.os.sync}</span>
							</li>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span><span>{t.os.byok}</span>
							</li>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span>
								<span
									>{t.os.noBackups}
									<span class="text-foreground/55"> {t.os.noBackupsNote}</span></span
								>
							</li>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span><span>{t.os.support}</span>
							</li>
						</ul>
					</div>
					<div class="min-w-0 lg:max-w-none">
						<p
							class="max-w-none text-[1.0625rem] font-light italic leading-snug text-foreground/84 sm:text-[1.125rem] sm:leading-snug"
						>
							{t.os.quote}
						</p>
						<p
							class="mt-5 max-w-none text-[14px] leading-[1.65] text-foreground/73 sm:text-[15px] sm:leading-[1.7]"
						>
							{t.os.noTrap}
						</p>
						<p
							class="mt-5 max-w-none text-[14px] font-medium leading-[1.6] text-foreground/78 sm:text-[15px] sm:leading-[1.68]"
						>
							<!-- {@html}: our own static copy, carries <strong> emphasis. -->
							{@html t.os.selfHostingHtml}
						</p>
					</div>
				</div>
				<div class="mt-8 flex justify-center border-t border-border/50 pt-6">
					<a
						href={openSourceGithubHref}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						{t.os.github}</a
					>
				</div>
			</div>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16" id="aven-id">
		<div class="mx-auto max-w-2xl">
			<AvenIdCheckCta variant="banner" {lang} />
		</div>
	</section>

	<SiteFooter {lang} />
</div>
