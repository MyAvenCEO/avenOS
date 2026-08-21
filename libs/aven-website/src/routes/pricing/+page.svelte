<svelte:head>
	<title>Preise — aven.ceo · avenCEO</title>
	<meta
		name="description"
		content="Ein Name als Anfang, drei Stufen darauf: avenID 30 € einmalig, avenME 42 €/Monat für dein Leben, avenCEO 326 €/Monat für deine Firma, avenCOOP als technischer Co‑Founder — auf Bewerbung."
	>
</svelte:head>

<script lang="ts">
import { page } from '$app/stores'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import { billingLabel, ctaHref, ctaLabel, euro, PLANS, plan, VAT_NOTE } from '$lib/pricing/plans'
import { skillsIncludedIn } from '$lib/skills/loader'

const openSourceGithubHref = 'https://github.com/jaensen/avenOS'

/** avenID is the door, not a tier in the grid — it gets its own band. */
const avenId = plan('avenid')
const tiers = PLANS.filter((p) => p.id !== 'avenid')

const claimedName = $derived($page.url.searchParams.get('name') ?? '')
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
					Ein Name als Anfang. Drei Stufen darauf.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
					<strong class="font-medium text-foreground/85">avenME</strong>
					organisiert dein Leben,
					<strong class="font-medium text-foreground/85">avenCEO</strong>
					führt deine Firma, und mit
					<strong class="font-medium text-foreground/85">avenCOOP</strong>
					werden wir dein technischer Co‑Founder. Jede Stufe enthält alles aus der darunter.
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
							Der Anfang
						</p>
						<p class="mt-1 text-xl font-semibold tracking-tight text-foreground">{avenId.name}</p>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{avenId.role}</p>
						<p class="mt-3 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
							{euro(avenId.eurPrice)}&nbsp;€
							<span class="text-[13px] font-medium text-foreground/55">einmalig · netto</span>
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
								? `/waitlist?intent=aven-id&preferred=${encodeURIComponent(claimedName)}`
								: ctaHref(avenId)}
							class="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-8 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 lg:w-auto"
						>
							{ctaLabel(avenId)}
						</a>
					</div>
				</div>
			</div>

			<!-- The three tiers. -->
			<div class="mt-6 grid gap-4 lg:grid-cols-3 lg:gap-5">
				{#each tiers as p, i (p.id)}
					{@const previous = i === 0 ? avenId : tiers[i - 1]}
					{@const skillCount = skillsIncludedIn(p.id, 'de').length}
					<div
						id={p.id}
						class="flex min-w-0 scroll-mt-28 flex-col rounded-2xl p-6 shadow-[0_1px_3px_rgba(30,41,59,0.05)] {p.highlight
							? 'border-2 border-accent/60 bg-surface-raised'
							: 'border border-foreground/8 bg-surface-raised'}"
					>
						<div class="flex items-baseline justify-between gap-2">
							<!-- No `uppercase`: the brand is spelled avenME, not AVENME. -->
							<p class="text-xl font-semibold tracking-tight text-foreground">{p.name}</p>
							{#if p.highlight}
								<span
									class="rounded-full bg-accent/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-ink"
								>
									Der Kern
								</span>
							{:else if p.applyOnly}
								<span
									class="rounded-full bg-quiet/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-quiet-ink"
								>
									Nur auf Bewerbung
								</span>
							{/if}
						</div>
						<p class="mt-1 text-[12px] leading-snug text-foreground/55">{p.role}</p>
						{#if p.eligibility}
							<p class="mt-2 text-[12px] leading-snug font-medium text-quiet-ink">
								{p.eligibility}
							</p>
						{/if}

						<div class="mt-5 border-y border-border/50 py-4">
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
									{billingLabel(p)}
								</p>
								{#if p.revenueSharePct > 0}
									<p
										class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45"
									>
										Umsatzbeteiligung
									</p>
								{/if}
							</div>
							<div class="mt-1 flex items-baseline justify-between gap-2">
								<p class="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
									{euro(p.eurPrice)}&nbsp;€<span class="text-base font-medium text-foreground/55">
										/Monat</span
									>
								</p>
								{#if p.revenueSharePct > 0}
									<p class="text-xl font-semibold tabular-nums tracking-tight text-accent-ink">
										+{p.revenueSharePct}&nbsp;%
									</p>
								{/if}
							</div>
							{#if p.revenueShareNote}
								<p class="mt-1.5 text-right text-[11px] leading-snug text-foreground/50">
									{p.revenueShareNote}
								</p>
							{/if}
							{#if p.equitySharePct}
								<p class="mt-2 text-right text-[12px] font-medium text-foreground/70">
									+{p.equitySharePct}&nbsp;% Firmenanteile
								</p>
							{/if}
							{#if p.reciprocalSharePct}
								<p class="text-right text-[12px] font-medium text-accent-ink">
									…und {p.reciprocalSharePct.toLocaleString('de-DE')}&nbsp;% der avenCEO GmbH für
									dich
								</p>
							{/if}
						</div>

						<ul class="mt-5 flex-1 space-y-2 text-left text-[13px] leading-snug text-foreground/75">
							<li class="flex gap-2 font-medium text-foreground/85">
								<span
									aria-hidden="true"
									class="mt-1.5 size-1.5 shrink-0 rounded-full {p.highlight
										? 'bg-accent'
										: 'bg-foreground/25'}"
								></span>
								<span>Alles aus {previous.name}</span>
							</li>
							{#each p.features as feature (feature)}
								<li class="flex gap-2">
									<span
										aria-hidden="true"
										class="mt-1.5 size-1.5 shrink-0 rounded-full {p.highlight
											? 'bg-accent'
											: 'bg-foreground/25'}"
									></span>
									<span>{feature}</span>
								</li>
							{/each}
						</ul>

						{#if p.link}
							<p class="mt-4 text-[12px] text-foreground/55">
								<a
									href={p.link.href}
									target="_blank"
									rel="noopener noreferrer"
									class="underline underline-offset-4 hover:text-foreground/80"
								>
									Syndikat auf {p.link.label} →
								</a>
							</p>
						{/if}

						{#if skillCount > 0}
							<p class="mt-4 border-t border-border/50 pt-3 text-[12px] text-foreground/50">
								<a
									href={`/skills?plan=${p.id}`}
									class="underline underline-offset-4 hover:text-foreground/75"
								>
									{skillCount}
									Skills enthalten →
								</a>
							</p>
						{/if}

						<div class="mt-5 lg:mt-auto lg:pt-5">
							<a
								href={ctaHref(p)}
								class="inline-flex min-h-11 w-full items-center justify-center rounded-full px-8 text-[13px] font-semibold transition-opacity hover:opacity-90 {p.applyOnly
									? 'border border-primary/45 text-foreground'
									: 'bg-primary text-primary-foreground'}"
							>
								{ctaLabel(p)}
							</a>
						</div>
					</div>
				{/each}
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

	<footer
		class="border-t border-border/40 px-5 py-10 sm:px-8 text-center text-[11px] uppercase tracking-[0.14em] text-foreground/35"
	>
		avenCEO · avenOS · Own your life
	</footer>
</div>
