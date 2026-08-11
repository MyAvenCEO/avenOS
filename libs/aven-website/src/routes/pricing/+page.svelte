<svelte:head>
	<title>Preise — aven.ceo · avenCEO</title>
	<meta
		name="description"
		content="Fünf Rollen, ein Stack: avenCOO, avenCMO, avenCTO, avenCPO, avenCEO — Monatspreis plus Umsatzbeteiligung, jede Stufe enthält die darunter. Sichere dir jetzt deinen avenCEO-Namen für 25 €."
	>
</svelte:head>

<script lang="ts">
import { page } from '$app/stores'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import { euro, PLANS } from '$lib/pricing/plans'
import { skillsIncludedIn } from '$lib/skills/loader'

const openSourceGithubHref = 'https://github.com/jaensen/avenOS'

/** One number, one promise: 25 € once, your name for a year. */
const avenIdPriceEur = 25

const claimedName = $derived($page.url.searchParams.get('name') ?? '')
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="pricing" />
	<section
		id="pricing-plans"
		class="scroll-mt-28 border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16"
	>
		<div class="mx-auto max-w-6xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Pricing
				</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Stell die Rolle ein, die dir gerade fehlt.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
					Fünf Rollen, aufeinander aufbauend — jede Stufe enthält alles aus der darunter.
					Monatspreis plus Umsatzbeteiligung: je weiter oben, desto mehr sind wir Partner statt
					Anbieter.
				</p>
			</div>

			<div class="mt-12 flex flex-col gap-5 lg:flex-row lg:gap-6 lg:items-stretch">
				<aside
					class="flex min-w-0 flex-col rounded-2xl border border-border/40 bg-white/55 p-5 ring-1 ring-black/5 lg:w-[min(20rem,100%)] lg:max-w-none lg:shrink-0"
				>
					{#if claimedName}
						<div
							class="mb-4 rounded-xl border border-tuscan-sun/50 bg-tuscan-sun/15 px-3 py-3 text-center"
						>
							<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">
								Deine Wahl
							</p>
							<p class="mt-1 text-[15px] font-semibold tracking-tight text-foreground">
								<strong class="text-tuscan-sun">{claimedName}</strong>.aven.ceo
							</p>
							<p class="mt-1 text-[11px] leading-snug text-foreground/60">
								für einmalig 25&nbsp;€ (gilt 1 Jahr) — Verfügbarkeit bestätigen wir bei der Buchung.
							</p>
						</div>
					{/if}
					<div class="text-center">
						<!-- The tier is the name itself: avenID, spelled like the rest. -->
						<p
							class="mt-2 font-mono text-lg font-bold tracking-[0.06em] text-foreground sm:text-xl"
						>
							avenID
						</p>
					</div>
					<div class="mt-3 space-y-2">
						<div class="text-center">
							<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
								Einmalig · gilt 1 Jahr
							</p>
							<p class="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">
								{avenIdPriceEur}&nbsp;€
							</p>
						</div>
					</div>
					<p
						class="mt-3 text-center font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-tuscan-sun"
					>
						Jeder Name existiert genau einmal
					</p>
					<ul class="mt-3 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75">
						<li>
							<strong class="font-medium text-foreground/82">4&nbsp;Std</strong>
							avenCEO Test‑Zugang
						</li>
						<li>
							z.&nbsp;B. <strong class="font-semibold text-foreground/82">maia</strong>
							<span class="text-foreground/55">· maia.aven.ceo · mail@maia.aven.ceo</span>
						</li>
						<li>
							<strong class="font-medium text-foreground/82">Einmalig vergeben</strong>
							<span class="text-foreground/55">
								· wer ihn zuerst nimmt, behält ihn — es gibt keinen zweiten</span
							>
						</li>
					</ul>
					<div class="mt-3 flex min-h-0 flex-1 flex-col justify-end gap-2">
						<div class="flex justify-center">
							<a
								href={claimedName
										? `/waitlist?intent=aven-id&preferred=${encodeURIComponent(claimedName)}`
										: '/waitlist?intent=aven-id'}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 sm:text-[13px]"
							>
								avenID sichern
							</a>
						</div>
					</div>
				</aside>

				<div class="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 lg:gap-5">
					{#each PLANS as p, i (p.id)}
						<div
							id={p.id}
							class="flex min-w-0 scroll-mt-28 flex-col rounded-2xl border p-5 {p.highlight
								? 'border-border/45 bg-tuscan-sun/55 ring-1 ring-black/6'
								: 'border-border/40 bg-white/50 ring-1 ring-black/5'}"
						>
							<div class="text-center">
								<!-- No `uppercase`: the brand is spelled avenCOO, not AVENCOO. -->
								<p
									class="mt-2 font-mono text-lg font-bold tracking-[0.06em] text-foreground sm:text-xl"
								>
									{p.name}
								</p>
								<p class="mt-1 text-[11px] leading-snug text-foreground/55">{p.role}</p>
							</div>
							<div class="mt-3 space-y-1">
								<div class="flex items-baseline justify-between gap-2">
									<p
										class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45"
									>
										Monatlich
									</p>
									<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">
										Umsatzbeteiligung
									</p>
								</div>
								<div class="flex items-baseline justify-between gap-2">
									<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
										{euro(p.eurPerMonth)}&nbsp;€<span
											class="text-lg font-semibold text-foreground/62"
											>/m</span
										>
									</p>
									<p
										class="text-right text-base font-semibold tabular-nums tracking-tight text-foreground/55"
									>
										+{p.revenueSharePct}&nbsp;%
									</p>
								</div>
							</div>
							<ul
								class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75"
							>
								{#if i > 0}
									<li class="font-medium text-foreground/85">Alles aus {PLANS[i - 1].name}</li>
								{/if}
								{#each p.features as feature (feature)}
									<li>{feature}</li>
								{/each}
							</ul>
							<p class="mt-4 border-t border-foreground/10 pt-3 text-[11px] text-foreground/50">
								<a
									href={`/skills?plan=${p.id}`}
									class="underline underline-offset-4 hover:text-foreground/75"
								>
									{skillsIncludedIn(p.id, 'de').length}
									Skills enthalten →
								</a>
							</p>
							<div class="mt-4 flex justify-center lg:mt-auto lg:pt-2">
								<a
									href={`/waitlist?intent=ceo-plan&tier=${p.id}`}
									class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
								>
									Buchen</a
								>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div
				class="mx-auto mt-12 max-w-6xl rounded-2xl border border-border/40 bg-white/40 p-5 ring-1 ring-black/5 sm:p-7 lg:p-8"
			>
				<div class="grid gap-10 lg:grid-cols-[minmax(13.5rem,17rem)_1fr] lg:gap-14 lg:items-start">
					<div
						class="shrink-0 border-b border-foreground/8 pb-8 lg:border-b-0 lg:border-r lg:border-foreground/8 lg:pb-0 lg:pr-10"
					>
						<p
							class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/45"
						>
							OPTIONAL · EIGENES HOSTING
						</p>
						<h3 class="mt-2 text-lg font-semibold text-foreground sm:text-xl">avenOS</h3>
						<p class="mt-1 text-[11px] leading-snug text-foreground/55 sm:text-[12px]">
							Open‑Source‑Stack zum Selbsthosten
						</p>
						<p class="mt-1 text-lg font-semibold tabular-nums text-foreground">0&nbsp;€</p>
						<ul
							class="mt-5 space-y-2 border-t border-border/30 pt-5 text-[13px] leading-snug text-foreground/72"
							aria-label="avenOS Übersicht"
						>
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground/40">·</span
								><span>Self‑hosted Sync‑Service</span>
							</li>
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground/40">·</span
								><span>Bring Your Own API Keys</span>
							</li>
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground/40">·</span>
								<span
									>Keine Backups<span class="text-foreground/55">
										— optional selbst bereitstellbar</span
									></span
								>
							</li>
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground/40">·</span
								><span>Community‑Forum‑Support</span>
							</li>
						</ul>
					</div>
					<div class="min-w-0 lg:max-w-none">
						<p
							class="max-w-none font-serif text-[1.0625rem] font-light italic leading-snug text-foreground/84 sm:text-[1.125rem] sm:leading-snug"
						>
							Kein Produkt ohne Haltung&nbsp;— das ist kein Satz aus dem Handbuch. Deine Daten
							gehören dir. Deine Arbeitsintelligenz gehört dir. Ende‑zu‑Ende‑verschlüsselt,
							Schlüssel bei dir&nbsp;— wir haben keinen Hinterzugang, und wir wollen keinen. Das
							wäre kein Geschäftsmodell. Das wäre Verrat.
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
				<div class="mt-8 flex justify-center border-t border-foreground/10 pt-6">
					<a
						href={openSourceGithubHref}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
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
		class="border-t border-border/40 px-5 py-10 sm:px-8 text-center text-[11px] font-mono text-foreground/30"
	>
		avenCEO · avenOS · Own your life
	</footer>
</div>

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
