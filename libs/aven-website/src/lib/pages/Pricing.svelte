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
import {
	ctaLabel,
	localizedPlan,
	money,
	perLabel,
	priceSuffix,
	shareNote,
	vatNote
} from '$lib/i18n/plans'
import { pricing } from '$lib/i18n/pricing'
import { idFunnelHref } from '$lib/id-service'
import { betaPrice, ctaHref, euro, PLANS, type Plan, type PlanId, plan } from '$lib/pricing/plans'
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

<!-- What the plan costs, in ONE panel: the monthly price on the left, the
     revenue share that comes off what it earns on the right, and — when the
     window is open — the BETA strip across the bottom. Every plan uses this
     same panel, so a reader learns the layout once.

     Container queries, not viewport ones: the panel sits in a half-width
     product card on one plan and in avenCOOP's narrow left column on
     another, and it has to split or stack by its OWN width. -->
{#snippet pricePanel(p: Plan)}
	{@const discounted = betaPrice(p)}
	<div class="@container mt-5 overflow-hidden rounded-2xl border border-border/50 bg-surface-card">
		<div class="flex flex-col @md:flex-row @md:items-stretch">
			<!-- With no share cell beside it (avenID), the lone price stays
			     centred instead of clinging to the left edge of a wide panel. -->
			<div
				class="min-w-0 flex-1 px-5 py-4 text-center {p.revenueSharePct > 0
					? '@md:text-left'
					: ''}"
			>
				<div
					class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 {p.revenueSharePct > 0
						? '@md:justify-start'
						: ''}"
				>
					<p
						class="text-3xl font-semibold tabular-nums tracking-tight {discounted !== null
							? 'text-foreground/40 line-through decoration-offer/60 decoration-2'
							: 'text-foreground'}"
					>
						{euro(p.eurPrice)}&nbsp;€
					</p>
					{#if discounted !== null}
						<!-- Tilted on purpose: a sticker slapped over the price, not
						     another number in the same row. -->
						<span
							class="-rotate-3 rounded-full bg-offer px-3 py-1 text-[15px] font-bold tabular-nums tracking-tight text-offer-foreground shadow-sm"
						>
							{money(discounted, lang)}&nbsp;€/m
						</span>
					{/if}
				</div>
				<p class="mt-1 text-[12px] font-medium leading-snug text-foreground/55">
					{priceSuffix(p, lang)}
				</p>
			</div>
			{#if p.revenueSharePct > 0}
				<!-- The number, what it is taken from, and the one reassurance —
				     vertically centred so it sits level with the price, however
				     tall the discount sticker makes that cell. -->
				<div
					class="flex min-w-0 flex-col justify-center border-t border-border/50 px-5 py-4 text-center @md:basis-[12rem] @md:border-t-0 @md:border-l"
				>
					<span class="block text-base font-semibold tabular-nums text-foreground/80">
						{t.pct(p.revenueSharePct)}
					</span>
					<span class="block text-[10px] leading-snug text-foreground/45">{t.ofRevenue}</span>
					<span class="mt-0.5 block text-[10px] leading-snug text-foreground/40">
						{shareNote(p, lang) ?? t.inclFees}
					</span>
				</div>
			{/if}
		</div>
		{#if p.beta && discounted !== null}
			<!-- Terracotta, not gold: the gold highlight says "this is the good
			     one", the burnt orange says "this window closes". -->
			<div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 bg-offer px-5 py-3">
				<span
					class="rounded-full bg-offer-foreground/18 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-offer-foreground"
				>
					{t.beta.badge}
				</span>
				<span class="text-[15px] font-bold tabular-nums tracking-tight text-offer-foreground">
					{t.beta.headline(p.beta.discountPct)}
				</span>
				<span class="text-[12px] leading-snug text-offer-foreground/85">
					{t.beta.note(p.beta.months, money(p.eurPrice, lang))}
				</span>
			</div>
		{/if}
	</div>
{/snippet}

<!-- The promise that outranks every feature below it. It speaks in the
     brand's turquoise — the settled, bright note — and drops the bullet
     dot: this is a statement, not a list item. -->
{#snippet sovereigntyBullet()}
	<li class="rounded-lg bg-success/10 px-3 py-2">
		<span class="leading-snug text-foreground/80">
			<strong class="font-semibold text-success-ink">{t.sovereignty.lead}</strong>
			{t.sovereignty.text}
		</span>
	</li>
{/snippet}

<!-- The transformation, before any fact: what changes in your life. This is
     the one block on a card allowed to be warm — everything below it earns
     trust with numbers, this line earns the wish. -->
{#snippet pitchLine(p: Plan)}
	<p
		class="mx-auto mt-4 max-w-md text-center text-[13.5px] leading-relaxed text-foreground/72 italic"
	>
		{p.pitch}
	</p>
{/snippet}

<!-- What the plan gives you per day. It sits at the TOP of a card now: what
     an Aven can DO is the first question, the price is the last one. -->
{#snippet runtimeCard(p: Plan)}
	{#if p.runtime}
		<div class="mt-4 rounded-xl border border-border/60 bg-surface-card px-4 py-3 text-left">
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
{/snippet}

<!-- Who the plan is for, as a tab riding the card's top border — half in,
     half out. `top-0 -translate-y-1/2` centres it on the edge whatever the
     badge's own height turns out to be, and the solid card background cuts
     the border line behind it. -->
{#snippet edgeBadge(label: string, highlight: boolean)}
	<span
		class="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border bg-surface-raised px-3 py-1 text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.12em] {highlight
			? 'border-accent/60 text-accent'
			: 'border-border text-quiet-ink'}"
	>
		{label}
	</span>
{/snippet}

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
				<!-- The wish first, the three facts after — same order as on the cards. -->
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-foreground/75">
					{t.lead}
				</p>
				<!-- {@html}: our own static copy, carries <strong> emphasis. -->
				<p class="mx-auto mt-5 max-w-xl text-[14px] leading-snug text-foreground/60">
					{@html t.introHtml}
				</p>
			</div>

			<!-- avenID: the door — and the same card language as everything below
			     it: badge riding the edge, centred name, the pitch, then facts.
			     Gold border and gold bullets keep it the lead-in, not a fourth
			     product. -->
			<div
				id={avenId.id}
				class="relative mt-12 scroll-mt-28 rounded-2xl border border-accent/45 bg-surface-card p-6 pt-8 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7 sm:pt-8"
			>
				{@render edgeBadge(t.idEyebrow, true)}
				<p class="text-center text-xl font-semibold tracking-tight text-foreground">
					{avenId.name}
				</p>
				<p class="mt-1 text-center text-[12px] leading-snug text-foreground/55">{avenId.role}</p>

				{@render pitchLine(avenId)}

				{#if claimedName}
					<p class="mt-4 text-center text-[13px] text-foreground/70">
						{t.yourChoice}
						<strong class="font-semibold text-accent">{claimedName}</strong>.aven.ceo —
						{t.availability}
					</p>
				{/if}

				<ul
					class="mx-auto mt-5 grid max-w-3xl gap-x-8 gap-y-2 border-t border-border/50 pt-5 text-[13px] leading-snug text-foreground/75 sm:grid-cols-2"
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

				{@render pricePanel(avenId)}

				<div class="mt-4">
					<a
						href={claimedName ? idFunnelHref('avenid', claimedName) : ctaHref(avenId)}
						class="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
					>
						{ctaLabel(avenId, lang)}
					</a>
				</div>
			</div>

			<!-- The two Aven, 50/50. -->
			<div class="mt-6 grid gap-4 lg:grid-cols-2 lg:gap-5">
				{#each products as p (p.id)}
					{@const skillCount = skillsIncludedIn(p.id, lang).length}
					{@const plain = p.features.filter((f) => typeof f === 'string' || 'href' in f)}
					{@const skills = skillFeatures(p)}
					{@const per = perLabel(p, lang)}
					<div
						id={p.id}
						class="relative flex min-w-0 scroll-mt-28 flex-col rounded-2xl p-6 pt-8 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {p.highlight
							? 'border-2 border-accent/60 bg-surface-raised'
							: 'border border-foreground/8 bg-surface-raised'}"
					>
						{#if per}
							{@render edgeBadge(per, p.highlight ?? false)}
						{/if}
						<!-- No `uppercase`: the brand is spelled avenME, not AVENME. -->
						<p class="text-center text-xl font-semibold tracking-tight text-foreground">{p.name}</p>
						<p class="mt-1 text-center text-[12px] leading-snug text-foreground/55">{p.role}</p>

						{@render pitchLine(p)}

						{@render pricePanel(p)}

						<div class="mt-4 flex-1 border-t border-border/50">
							{@render runtimeCard(p)}
							<ul class="mt-4 space-y-2 text-left text-[13px] leading-snug text-foreground/75">
								{@render sovereigntyBullet()}
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
						</div>

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

						<div class="mt-4">
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
					</div>
				{/each}
			</div>

			<!-- The last row, 2/3–1/3: avenCOOP (the business) next to avenOS (the
			     open door). Both wear the same card language as everything above. -->
			<div class="mt-6 grid items-stretch gap-4 md:grid-cols-5 lg:grid-cols-3 lg:gap-5">
				<!-- avenCOOP: badge on the edge, centred header, runtime, then what
				     you get. Only the body splits in two — this card has the room. -->
				<div
					id={coop.id}
					class="relative flex scroll-mt-28 flex-col rounded-2xl border border-foreground/8 bg-surface-raised p-6 pt-8 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7 sm:pt-8 md:col-span-3 lg:col-span-2"
				>
					{@render edgeBadge(t.applyOnly, false)}
					<p class="text-center text-xl font-semibold tracking-tight text-foreground">
						{coop.name}
					</p>
					<p class="mt-1 text-center text-[12px] leading-snug text-foreground/55">{coop.role}</p>

					{@render pitchLine(coop)}

					{@render pricePanel(coop)}

					<div class="mt-4 grid gap-8 border-t border-border/50 lg:grid-cols-[1fr_15rem] lg:gap-8">
						<div>
							{@render runtimeCard(coop)}
							<ul class="mt-4 space-y-2 text-left text-[13px] leading-snug text-foreground/75">
								{@render sovereigntyBullet()}
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
						</div>

						{#if coopSkillCount > 0}
							<div class="pt-4 text-left lg:border-l lg:border-border/50 lg:pl-8">
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
							</div>
						{/if}
					</div>

					<div class="mt-4">
						<a
							href={ctaHref(coop)}
							class="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-10 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
						>
							{ctaLabel(coop, lang)}
						</a>
					</div>
				</div>

				<!-- avenOS: the open door, compacted into the 1/3 column — same
				     card grammar, single column, the manifesto in small print. -->
				<div
					class="relative flex min-w-0 flex-col rounded-2xl border border-foreground/8 bg-surface-raised p-6 pt-8 shadow-[0_1px_3px_rgba(30,41,59,0.05)] md:col-span-2 lg:col-span-1"
				>
					{@render edgeBadge(t.os.eyebrow, false)}
					<p class="text-center text-xl font-semibold tracking-tight text-foreground">
						{t.os.title}
					</p>
					<p class="mt-1 text-center text-[12px] leading-snug text-foreground/55">
						{t.os.subtitle}
					</p>

					<div
						class="mt-5 rounded-2xl border border-border/50 bg-surface-card px-5 py-4 text-center"
					>
						<p class="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
							0&nbsp;€
						</p>
					</div>

					<ul
						class="mt-4 space-y-2 border-t border-border/50 pt-4 text-left text-[13px] leading-snug text-foreground/72"
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

					<div
						class="mt-4 flex-1 space-y-3 border-t border-border/50 pt-4 text-left text-[12px] leading-relaxed text-foreground/65"
					>
						<p class="font-light italic text-foreground/75">{t.os.quote}</p>
						<p>{t.os.noTrap}</p>
						<!-- {@html}: our own static copy, carries <strong> emphasis. -->
						<p>{@html t.os.selfHostingHtml}</p>
					</div>

					<div class="mt-4">
						<a
							href={openSourceGithubHref}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
						>
							{t.os.github}</a
						>
					</div>
				</div>
			</div>

			<p class="mt-6 text-center text-[12px] text-foreground/50">{vatNote(lang)}</p>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16" id="aven-id">
		<div class="mx-auto max-w-2xl">
			<AvenIdCheckCta variant="banner" {lang} />
		</div>
	</section>

	<SiteFooter {lang} />
</div>
