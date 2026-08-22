<svelte:head>
	<title>Preise — aven.ceo · avenCEO</title>
	<meta
		name="description"
		content="Ein Name als Anfang, zwei Aven nebeneinander: avenID 25 € einmalig, avenME 42 €/Monat pro Mensch, avenCEO 326 €/Monat pro Firma — keine Stufen, zwei Rollen. avenCOOP als technischer Co‑Founder — auf Bewerbung."
	>
</svelte:head>

<script lang="ts">
import { browser } from '$app/environment'
import { page } from '$app/stores'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import { idFunnelHref } from '$lib/id-service'
import {
	ctaHref,
	ctaLabel,
	euro,
	PLANS,
	perLabel,
	plan,
	priceSuffix,
	totalSharePct,
	VAT_NOTE
} from '$lib/pricing/plans'
import { loadSkill, skillDetailHref, skillLabel, skillsIncludedIn } from '$lib/skills/loader'

const openSourceGithubHref = 'https://github.com/jaensen/avenOS'

/** avenID is the door, not a product in the grid — it gets its own band. */
const avenId = plan('avenid')
/** The two Aven: one per human, one per company. Side by side, not stacked. */
const products = PLANS.filter((p) => p.id === 'avenme' || p.id === 'avenceo')
/** avenCOOP is a relationship, not a third column — its own band below. */
const coop = plan('avencoop')
const coopSkillCount = skillsIncludedIn(coop.id, 'de').length

// Static site (prerendered): the query string only exists in the browser, never at build time.
const claimedName = $derived(browser ? ($page.url.searchParams.get('name') ?? '') : '')
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="pricing" maxWidth="6xl" />

	<section
		id="pricing-plans"
		class="scroll-mt-28 border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16"
	>
		<div class="mx-auto max-w-6xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Pricing</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Ein Name als Anfang. Zwei Aven nebeneinander.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
					<strong class="font-medium text-foreground/85">avenME</strong>
					ist dein persönlicher Aven — einer pro Mensch.
					<strong class="font-medium text-foreground/85">avenCEO</strong>
					ist der Aven deiner Firma — einer pro Firma. Zwei Rollen, zwei Produkte, keine Stufen: Das
					eine ist kein Upgrade des anderen, beide leben im selben Namensraum. Mit
					<strong class="font-medium text-foreground/85">avenCOOP</strong>
					werden wir dein technischer Co‑Founder.
				</p>
				<p class="mx-auto mt-4 max-w-xl text-[14px] leading-snug text-foreground/55">
					Der Anteil am Umsatz ist zur Hälfte Plattform und zur Hälfte
					<strong class="font-medium text-accent-ink">Reinvest</strong>: Er kauft dir Anteile an den
					avenCOOPs anderer Gründer — du wählst selbst, an welchen.
				</p>
			</div>

			<!-- avenID: the door. One line, one price, the things you get. -->
			<div
				id={avenId.id}
				class="mt-12 scroll-mt-28 rounded-2xl border border-accent/45 bg-surface-card p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7"
			>
				{#if claimedName}
					<p class="mb-5 text-center text-[13px] text-foreground/70">
						Deine Wahl:
						<strong class="font-semibold text-accent-ink">{claimedName}</strong>.aven.ceo —
						Verfügbarkeit bestätigen wir bei der Buchung.
					</p>
				{/if}
				<div class="flex flex-col gap-6 lg:flex-row lg:items-center lg:gap-10">
					<div class="lg:w-64 lg:shrink-0">
						<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
							Der Anfang · Pflicht für beide
						</p>
						<p class="mt-1 text-xl font-semibold tracking-tight text-foreground">{avenId.name}</p>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{avenId.role}</p>
						<p class="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
							{euro(avenId.eurPrice)}&nbsp;€
							<span class="text-[13px] font-medium text-foreground/55">{priceSuffix(avenId)}</span>
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
							{ctaLabel(avenId)}
						</a>
					</div>
				</div>
			</div>

			<!-- The two Aven, 50/50. -->
			<div class="mt-6 grid gap-4 lg:grid-cols-2 lg:gap-5">
				{#each products as p (p.id)}
					{@const skillCount = skillsIncludedIn(p.id, 'de').length}
					{@const plain = p.features.filter((f) => typeof f === 'string' || 'href' in f)}
					{@const skills = p.features
						.filter((f) => typeof f !== 'string' && 'skill' in f)
						.sort(
							(a, b) =>
								Number(loadSkill(a.skill, 'de')?.comingSoon ?? false) -
								Number(loadSkill(b.skill, 'de')?.comingSoon ?? false)
						)}
					<div
						id={p.id}
						class="flex min-w-0 scroll-mt-28 flex-col rounded-2xl p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {p.highlight
							? 'border-2 border-accent/60 bg-surface-raised'
							: 'border border-foreground/8 bg-surface-raised'}"
					>
						<div class="flex items-baseline justify-between gap-2">
							<!-- No `uppercase`: the brand is spelled avenME, not AVENME. -->
							<p class="text-xl font-semibold tracking-tight text-foreground">{p.name}</p>
							{#if perLabel(p)}
								<span
									class="rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] {p.highlight
										? 'bg-accent/20 text-accent-ink'
										: 'bg-quiet/15 text-quiet-ink'}"
								>
									{perLabel(p)}
								</span>
							{/if}
						</div>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{p.role}</p>

						<!-- The monthly price stands alone. What comes off the revenue is a
						     different question, so it gets its own block rather than hanging
						     off the right edge of the price. -->
						<div class="mt-5 border-t border-border/50 pt-4">
							<p class="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
								{euro(p.eurPrice)}&nbsp;€<span class="text-base font-medium text-foreground/55"
									>{priceSuffix(p)}</span
								>
							</p>
						</div>

						{#if totalSharePct(p) > 0}
							<div class="mt-4 border-t border-border/50 pt-4">
								<div class="flex items-baseline justify-between gap-2">
									<p
										class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45"
									>
										Vom Umsatz
									</p>
									<p class="text-xl font-semibold tabular-nums tracking-tight text-accent-ink">
										{totalSharePct(p)}&nbsp;%
									</p>
								</div>
								<!-- The split is the whole point: half is a price, half buys you shares. -->
								<dl class="mt-2 space-y-1 text-[11px] leading-snug">
									<div>
										<dt class="text-foreground/55">
											{p.platformFeePct}&nbsp;% Plattform
											<span class="text-foreground/40">· inkl. Stripe &amp; Co.</span>
										</dt>
									</div>
									<div>
										<dt class="font-medium text-accent-ink">
											{p.reinvestPct}&nbsp;% Reinvest
											<span class="font-normal text-foreground/55">
												· in avenCOOPs anderer Gründer</span
											>
										</dt>
									</div>
								</dl>
								{#if p.equitySharePct}
									<p class="mt-3 text-[12px] font-medium text-foreground/70">
										+&nbsp;{p.equitySharePct}&nbsp;% Firmenanteile an deiner Firma
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
										Ein avenCEO pro Firma — jede weitere Firma bekommt ihren eigenen.
									{:else}
										Ein avenME pro Mensch — dein eigener, unabhängig von jeder Firma.
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
									Skills
								</p>
								{#if skills.length > 0}
									<ul class="mt-2 space-y-1.5 text-[13px] leading-snug">
										{#each skills as feature (feature.skill)}
											{@const soon = loadSkill(feature.skill, 'de')?.comingSoon}
											<li class={soon ? 'opacity-70' : ''}>
												<a
													href={skillDetailHref(feature.skill, 'de')}
													class="font-medium underline underline-offset-4 transition-colors {soon
														? 'text-quiet-ink decoration-dashed decoration-quiet/40 hover:decoration-quiet/70'
														: 'text-foreground decoration-foreground/25 hover:decoration-foreground/60'}"
												>
													{skillLabel(feature.skill)}
												</a>
												{#if soon}
													<span
														class="ml-1 rounded-full border border-quiet/45 bg-quiet/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-quiet-ink"
														>bald</span
													>
												{/if}
												<span class={soon ? 'text-foreground/45' : 'text-foreground/55'}>
													· {feature.label}</span
												>
											</li>
										{/each}
									</ul>
								{/if}
								{#if skillCount > 0}
									<p class="mt-2 text-[12px] text-foreground/50">
										<a
											href={`/skills?plan=${p.id}`}
											class="underline underline-offset-4 hover:text-foreground/75"
										>
											Alle {skillCount} Skills ansehen →
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
									KI‑Laufzeit
								</p>
								<p class="mt-1 text-[13px] font-medium leading-snug text-foreground/85">
									Bis zu {p.runtime.hoursPerDay}&nbsp;Std/Tag Agent‑Laufzeit
									<span class="font-normal text-foreground/55">(Fair Use)</span>
								</p>
								<p class="mt-0.5 text-[12px] leading-snug text-foreground/55">
									danach {p.runtime.centsPerExtraMinute}&nbsp;Cent pro Minute
								</p>
							</div>
						{/if}

						<div class="mt-5 lg:mt-auto lg:pt-5">
							<a
								href={ctaHref(p)}
								class="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
							>
								{ctaLabel(p)}
							</a>
							<p class="mt-2 text-center text-[11px] leading-snug text-foreground/50">
								+ {avenId.name} ({euro(avenId.eurPrice)}&nbsp;€ einmalig) im Bundle, falls du noch
								keine hast — avenID ist nicht enthalten.
							</p>
						</div>

						{#if p.referralPct}
							<p class="mt-4 text-center">
								<span class="text-xl font-semibold tracking-tight text-accent">
									{p.referralPct}&nbsp;% Provision
								</span>
								<span class="mt-1 block text-[12px] leading-snug text-foreground/55">
									auf jedes aven‑Abo, das du vermittelst — monatlich, solange es läuft.
								</span>
							</p>
						{/if}
					</div>
				{/each}
			</div>

			<!-- avenCOOP: a relationship, full width. Includes the company's avenCEO. -->
			<div
				id={coop.id}
				class="mt-6 scroll-mt-28 rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7"
			>
				<div class="grid gap-8 lg:grid-cols-[minmax(14rem,17rem)_1fr_auto] lg:gap-10">
					<div class="border-b border-border/50 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-10">
						<span
							class="inline-block rounded-full bg-quiet/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-quiet-ink"
						>
							Nur auf Bewerbung
						</span>
						<p class="mt-3 text-xl font-semibold tracking-tight text-foreground">{coop.name}</p>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{coop.role}</p>
						<p class="mt-4 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
							{euro(coop.eurPrice)}&nbsp;€<span class="text-base font-medium text-foreground/55"
								>{priceSuffix(coop)}</span
							>
						</p>
						<div class="mt-4 border-t border-border/50 pt-4">
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
									Vom Umsatz
								</p>
								<p class="text-xl font-semibold tabular-nums tracking-tight text-accent-ink">
									{totalSharePct(coop)}&nbsp;%
								</p>
							</div>
							<dl class="mt-2 space-y-1 text-[11px] leading-snug">
								<div>
									<dt class="text-foreground/55">
										{coop.platformFeePct}&nbsp;% Plattform
										<span class="text-foreground/40">· inkl. Stripe &amp; Co.</span>
									</dt>
								</div>
								<div>
									<dt class="font-medium text-accent-ink">
										{coop.reinvestPct}&nbsp;% Reinvest
										<span class="font-normal text-foreground/55">
											· in avenCOOPs anderer Gründer</span
										>
									</dt>
								</div>
							</dl>
							{#if coop.equitySharePct}
								<p class="mt-3 text-[12px] font-medium text-foreground/70">
									+&nbsp;{coop.equitySharePct}&nbsp;% Firmenanteile an deiner Firma
								</p>
							{/if}
						</div>
					</div>

					<div class="min-w-0">
						<ul class="grid gap-2 text-[13px] leading-snug text-foreground/75 sm:grid-cols-2">
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
												href={skillDetailHref(feature.skill, 'de')}
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
						{#if coopSkillCount > 0}
							<p class="mt-3 text-[12px] text-foreground/50">
								<a
									href={`/skills?plan=${coop.id}`}
									class="underline underline-offset-4 hover:text-foreground/75"
								>
									Alle {coopSkillCount} Skills ansehen →
								</a>
							</p>
						{/if}
						{#if coop.runtime}
							<p class="mt-4 text-[12px] leading-snug text-foreground/55">
								<span class="font-semibold uppercase tracking-[0.12em] text-accent"
									>KI‑Laufzeit</span
								>
								· bis zu {coop.runtime.hoursPerDay}&nbsp;Std/Tag (Fair Use), danach
								{coop.runtime.centsPerExtraMinute}&nbsp;Cent pro Minute
							</p>
						{/if}
					</div>

					<div class="flex flex-col items-stretch justify-center gap-3 lg:w-56">
						<a
							href={ctaHref(coop)}
							class="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-primary/45 px-8 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-soft"
						>
							{ctaLabel(coop)}
						</a>
						{#if coop.referralPct}
							<p class="text-center">
								<span class="text-xl font-semibold tracking-tight text-accent">
									{coop.referralPct}&nbsp;% Provision
								</span>
								<span class="mt-1 block text-[12px] leading-snug text-foreground/55">
									auf jedes aven‑Abo, das du vermittelst — monatlich, solange es läuft.
								</span>
							</p>
						{/if}
					</div>
				</div>
			</div>

			<p class="mt-6 text-center text-[12px] text-foreground/50">{VAT_NOTE}</p>

			<div
				class="mx-auto mt-12 max-w-6xl rounded-2xl border border-foreground/8 bg-surface-raised p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:p-7 lg:p-8"
			>
				<div class="grid gap-10 lg:grid-cols-[minmax(13.5rem,17rem)_1fr] lg:gap-14 lg:items-start">
					<div
						class="shrink-0 border-b border-border/50 pb-8 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-10"
					>
						<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
							Optional · Eigenes Hosting
						</p>
						<h3 class="mt-2 text-lg font-semibold text-foreground sm:text-xl">avenOS</h3>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">
							Open‑Source‑Stack zum Selbsthosten
						</p>
						<p class="mt-1 text-lg font-semibold tabular-nums text-foreground">0&nbsp;€</p>
						<ul
							class="mt-5 space-y-2 border-t border-border/50 pt-5 text-[13px] leading-snug text-foreground/72"
							aria-label="avenOS Übersicht"
						>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span><span>Self‑hosted Sync‑Service</span>
							</li>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span><span>Bring Your Own API Keys</span>
							</li>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span>
								<span
									>Keine Backups<span class="text-foreground/55">
										— optional selbst bereitstellbar</span
									></span
								>
							</li>
							<li class="flex gap-2">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/25"
								></span><span>Community‑Forum‑Support</span>
							</li>
						</ul>
					</div>
					<div class="min-w-0 lg:max-w-none">
						<p
							class="max-w-none text-[1.0625rem] font-light italic leading-snug text-foreground/84 sm:text-[1.125rem] sm:leading-snug"
						>
							Kein Produkt ohne Haltung&nbsp;— das ist kein Satz aus dem Handbuch. Deine Daten
							gehören dir. Deine Arbeitsintelligenz gehört dir. Ende‑zu‑Ende‑verschlüsselt,
							Schlüssel bei dir&nbsp;— wir haben keinen Hinterzugang, und wir wollen keinen.
						</p>
						<p
							class="mt-5 max-w-none text-[14px] leading-[1.65] text-foreground/73 sm:text-[15px] sm:leading-[1.7]"
						>
							Wir bauen keine Falle. Wenn du gehst, kommen deine Skills und deine gesamte aufgebaute
							Arbeitsintelligenz mit. Kein Pflichtgespräch, kein Labyrinth, das sich erst beim
							Kündigen zeigt. Wer dich festhält, wenn du frei sein willst, war nie wirklich auf
							deiner Seite.
						</p>
						<p
							class="mt-5 max-w-none text-[14px] font-medium leading-[1.6] text-foreground/78 sm:text-[15px] sm:leading-[1.68]"
						>
							<strong class="font-semibold text-foreground/85">Self‑Hosting über avenOS</strong>
							ist für alle, die ihre eigene Infra lieben&nbsp;— und für alle, die einfach wissen
							wollen, dass die Tür offen ist.
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
						avenOS auf GitHub</a
					>
				</div>
			</div>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16" id="aven-id">
		<div class="mx-auto max-w-2xl">
			<AvenIdCheckCta variant="banner" />
		</div>
	</section>

	<SiteFooter />
</div>
