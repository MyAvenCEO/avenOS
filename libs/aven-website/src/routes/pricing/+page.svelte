<svelte:head>
	<title>Preise — aven.ceo · AvenCEO</title>
	<meta
		name="description"
		content="Wähle das Paket, das zu deiner unternehmerischen Phase passt — Founder, Startup oder Investor CEO. Sichere dir jetzt deine AvenID für 8 € statt 55 €."
	>
</svelte:head>

<script lang="ts">
import { page } from '$app/stores'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'

const openSourceGithubHref = 'https://github.com/jaensen/AvenOS'

const avenIdPriceStandardEur = 55
const avenIdPriceEarlyBirdEur = 8
const avenIdDiscountVsStandardPct = Math.round(
	((avenIdPriceStandardEur - avenIdPriceEarlyBirdEur) / avenIdPriceStandardEur) * 100
)

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
					Wähle das Paket, das zu deiner aktuellen unternehmerischen Phase passt.
				</h2>
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
								für 8&nbsp;€ statt 55&nbsp;€ — Verfügbarkeit bestätigen wir bei der Buchung.
							</p>
						</div>
					{/if}
					<div class="text-center">
						<p
							class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]"
						>
							Aven CEO – ID
						</p>
					</div>
					<div class="mt-3 space-y-2">
						<div class="grid grid-cols-2 gap-x-3 gap-y-1">
							<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
								Early&nbsp;Bird
							</p>
							<p
								class="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45"
							>
								Standard
							</p>
							<div class="flex min-w-0 flex-nowrap items-center justify-start gap-x-2">
								<span
									class="shrink-0 text-2xl font-bold tabular-nums tracking-tight text-foreground"
									>{avenIdPriceEarlyBirdEur}&nbsp;€</span
								>
								<span
									class="inline-flex shrink-0 items-center rounded-full border border-border/45 bg-tuscan-sun/55 px-2 py-0.5 text-[13px] font-semibold tabular-nums leading-none tracking-tight text-foreground ring-1 ring-black/6 sm:text-sm"
									title={`Ersparnis gegenüber Standard (${avenIdPriceStandardEur}\u00a0€)`}
								>
									−{avenIdDiscountVsStandardPct}&nbsp;%</span
								>
							</div>
							<p class="text-right text-2xl font-bold tabular-nums tracking-tight text-foreground">
								{avenIdPriceStandardEur}&nbsp;€
							</p>
							<p
								class="col-span-2 mt-2 text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-tuscan-sun sm:text-[13px]"
							>
								Nur noch 10x Early&nbsp;Bird
							</p>
						</div>
					</div>
					<ul class="mt-4 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75">
						<li>
							<strong class="font-medium text-foreground/82">4&nbsp;Std</strong>
							AvenCEO Test‑Zugang
						</li>
						<li>Sichere dir deine AvenID</li>
						<li>
							z.&nbsp;B. <strong class="font-semibold text-foreground/82">AvenBob</strong>
							<span class="text-foreground/55">· bob.aven.ceo · bob@aven.ceo</span>
						</li>
						<li>Exklusiver Social‑CEO‑Netzwerk‑Zugang</li>
						<li>
							Einfaches
							<strong class="font-medium text-foreground/82">One‑Click‑Self‑Hosting</strong>
							mit deiner Aven&nbsp;ID
							<span class="text-foreground/55">· BYO API‑Keys</span>
						</li>
					</ul>
					<div class="mt-3 flex min-h-0 flex-1 flex-col justify-end gap-2">
						<div class="border-t border-foreground/8 pt-3 text-center">
							<p
								class="font-mono text-[8px] font-bold uppercase tracking-[0.22em] text-foreground/45"
							>
								Bonus
							</p>
							<p
								class="mt-1 text-center text-[9px] leading-snug text-foreground/62 sm:text-[10px] sm:leading-[1.42]"
							>
								<strong class="font-medium text-foreground/78">Dauerhafter Zugang</strong>
								zu Maia&nbsp;City — das
								<strong class="font-medium text-foreground/78">CEO‑Gründerspiel</strong>, in dem wir
								skizzieren, wie wir
								<strong class="font-medium text-foreground/82"
									>menschliche Städte von morgen</strong
								>
								in den Arbeitsalltag einweben. Eine
								<strong class="font-medium text-foreground/82"
									>Post‑AGI‑Wirtschaftssimulation</strong
								>: Gründerinnen und Gründer erproben kühnere und freundlichere Rhythmen von
								Wirtschaft, Fürsorge und
								<strong class="font-medium text-foreground/82">besseren Lebensweisen</strong>.
							</p>
						</div>
						<div class="flex justify-center">
							<a
								href={claimedName
										? `/waitlist?intent=aven-id&preferred=${encodeURIComponent(claimedName)}`
										: '/waitlist?intent=aven-id'}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 sm:text-[13px]"
							>
								Aven Name sichern
							</a>
						</div>
					</div>
				</aside>

				<div class="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
					<div
						class="flex min-w-0 flex-col rounded-2xl border border-border/45 bg-tuscan-sun/55 p-5 ring-1 ring-black/6"
					>
						<div class="text-center">
							<p
								class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]"
							>
								Founder CEO
							</p>
						</div>
						<div class="mt-3 space-y-1">
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
									Erste 3 Monate
								</p>
								<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">
									Danach
								</p>
							</div>
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
									144&nbsp;€<span class="text-lg font-semibold text-foreground/62">/m</span>
								</p>
								<p
									class="text-right text-base font-semibold tabular-nums tracking-tight text-foreground/55"
								>
									233&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span>
								</p>
							</div>
						</div>
						<ul
							class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75"
						>
							<li>1 Aven ID</li>
							<li>
								KI inklusive: max.
								<strong class="font-medium text-foreground/82">1&nbsp;Std / Tag</strong>
								<span class="text-foreground/55">(~60&nbsp;Min.)</span>
							</li>
							<li>2 Workspaces Private + Work</li>
							<li>25 Skills</li>
							<li>Unbegrenzte Import‑Connectors</li>
							<li>Social‑Media‑Export‑Connectors</li>
							<li>100&nbsp;GB Storage</li>
							<li>Wöchentliche Snapshots</li>
							<li>AvenOS&nbsp;support</li>
						</ul>
						<div class="mt-6 flex justify-center border-t border-foreground/10 pt-4 lg:mt-auto">
							<a
								href="/waitlist?intent=ceo-plan&tier=founder"
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
							>
								Buchen</a
							>
						</div>
					</div>

					<div
						class="flex min-w-0 flex-col rounded-2xl border border-border/40 bg-white/50 p-5 ring-1 ring-black/5"
					>
						<div class="text-center">
							<p
								class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]"
							>
								Startup CEO
							</p>
						</div>
						<div class="mt-3 space-y-1">
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
									Erste 6 Monate
								</p>
								<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">
									Danach
								</p>
							</div>
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
									610&nbsp;€<span class="text-lg font-semibold text-foreground/62">/m</span>
								</p>
								<p
									class="text-right text-base font-semibold tracking-tight text-foreground/55 tabular-nums"
								>
									987&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span>
								</p>
							</div>
						</div>
						<ul
							class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75"
						>
							<li>1 Aven ID</li>
							<li>
								KI inklusive: max.
								<strong class="font-medium text-foreground/82">4&nbsp;Std / Tag</strong>
								<span class="text-foreground/55">(~240&nbsp;Min.)</span>
							</li>
							<li>5 Workspaces</li>
							<li>Unbegrenzte Skills</li>
							<li>Unbegrenzte Import‑Connectors</li>
							<li>10 Export‑Connectors</li>
							<li>4&nbsp;TB Storage</li>
							<li>Tägliche Snapshots</li>
							<li>Nie wieder Papier – Briefpost digital</li>
							<li class="font-medium text-foreground/82">Support durch AvenTin&nbsp;+ AvenMaia</li>
							<li class="font-medium text-foreground/82">+ 1&nbsp;Std/Woche Samuel &amp; Daniel</li>
						</ul>
						<div class="mt-6 flex justify-center border-t border-foreground/10 pt-4 lg:mt-auto">
							<a
								href="/waitlist?intent=ceo-plan&tier=startup"
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
							>
								Buchen</a
							>
						</div>
					</div>

					<div
						class="flex min-w-0 flex-col rounded-2xl border border-border/45 bg-white/55 p-5 ring-1 ring-black/5 sm:col-span-2 lg:col-span-1"
					>
						<div class="text-center">
							<p
								class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]"
							>
								Investor CEO
							</p>
						</div>
						<div class="mt-3 space-y-1">
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
									Erste 12 Monate
								</p>
								<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">
									Danach
								</p>
							</div>
							<div class="flex items-baseline justify-between gap-2">
								<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
									6.875&nbsp;€<span class="text-lg font-semibold text-foreground/62">/m</span>
								</p>
								<p
									class="text-right text-base font-semibold tracking-tight text-foreground/55 tabular-nums"
								>
									10.950&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span>
								</p>
							</div>
						</div>
						<ul
							class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75"
						>
							<li>1 Aven ID</li>
							<li>
								KI inklusive: bis zu
								<strong class="font-medium text-foreground/82">24&nbsp;Std / Tag</strong>
								<span class="text-foreground/55">(Fair‑Use)</span>
							</li>
							<li>100 Workspaces</li>
							<li>Unbegrenzte Skills</li>
							<li>Unbegrenzte Import‑ &amp; Export‑Connectors</li>
							<li>12&nbsp;TB + monatliches LTO</li>
							<li>Stündliche Snapshots</li>
							<li>Nie wieder Papier – Briefpost digital</li>
							<li class="font-medium text-foreground/82">Support durch AvenTin&nbsp;+ AvenMaia</li>
							<li class="font-medium text-foreground/82">
								+ 10&nbsp;Std/Woche Samuel &amp; Daniel
							</li>
							<li class="font-semibold text-foreground">Become an AvenCEO Shareholder</li>
						</ul>
						<div class="mt-6 flex justify-center border-t border-foreground/10 pt-4 lg:mt-auto">
							<a
								href="/waitlist?intent=ceo-plan&tier=investor"
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
							>
								Buchen</a
							>
						</div>
					</div>
				</div>
			</div>

			<div
				class="mx-auto mt-12 max-w-4xl rounded-2xl border border-border/50 bg-linear-to-br from-white/55 via-white/38 to-transparent px-5 py-6 shadow-[0_12px_40px_-24px_rgb(0_0_0/0.35)] ring-1 ring-black/6 sm:mt-14 sm:px-8 sm:py-8"
			>
				<p
					class="text-center font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-tuscan-sun sm:text-[11px]"
				>
					OPTIONAL · MEHR KI + COACH PER MINUTE
				</p>
				<p
					class="mx-auto mt-2 max-w-2xl text-center font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-foreground/45 sm:text-[10px]"
				>
					Extra KI‑Minuten&nbsp;· höchst persönlicher Skill‑Support durch Samuel&nbsp;&amp; Daniel
				</p>
				<div
					class="mt-6 flex flex-col gap-8 lg:mt-8 lg:flex-row lg:items-stretch lg:gap-0 lg:divide-x lg:divide-border/35"
				>
					<aside
						class="border-b border-border/35 pb-8 text-center lg:w-[min(17rem,38%)] lg:shrink-0 lg:border-b-0 lg:border-border/35 lg:pb-0 lg:pr-8 lg:text-left"
					>
						<p
							class="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-foreground/45"
						>
							Zusätzliche KI‑Minuten
						</p>
						<p
							class="mx-auto mt-3 max-w-[16rem] text-[13px] leading-snug text-foreground/72 lg:mx-0"
						>
							Jede zusätzliche
							<strong class="font-medium text-foreground/82">KI‑Minute</strong>
							über dein tagesbezogenes Kontingent.
						</p>
						<p
							class="mx-auto mt-4 text-2xl font-bold tabular-nums tracking-tight text-foreground lg:mx-0"
						>
							10&nbsp;Cent/min
						</p>
						<p
							class="mx-auto mt-2 max-w-[16rem] font-mono text-[10px] font-medium leading-snug uppercase tracking-[0.08em] text-foreground/38 lg:mx-0"
						>
							Kein Mindestvolumen · minutengleich abgerechnet
						</p>
					</aside>
					<div class="min-w-0 flex-1 lg:pl-8">
						<p
							class="mx-auto max-w-xl text-center text-[14px] font-medium leading-relaxed text-foreground/74 sm:text-[16px] sm:leading-snug lg:mx-0 lg:max-w-none lg:text-left"
						>
							Wenn du bei deinem Skill‑Tuning Hilfe brauchst, begleiten dich Samuel + Daniel höchst
							persönlich — jeder Use&nbsp;Case, nach Bedarf auf
							<strong class="font-semibold text-foreground/82">Minutenbasis</strong>.
						</p>
						<div
							class="mx-auto mt-6 grid max-w-sm grid-cols-1 gap-7 text-center sm:mt-8 sm:max-w-2xl sm:grid-cols-3 sm:gap-6 lg:mx-0"
						>
							<div class="flex flex-col items-center gap-1 lg:items-start lg:text-left">
								<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/50">
									Founder
								</p>
								<p class="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
									3&nbsp;€/min
								</p>
								<p
									class="text-[11px] font-medium tabular-nums tracking-tight text-foreground/42 sm:text-[12px]"
								>
									≈ 180&nbsp;€/h
								</p>
							</div>
							<div class="flex flex-col items-center gap-1 lg:items-start lg:text-left">
								<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/50">
									Startup
								</p>
								<p class="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
									4&nbsp;€/min
								</p>
								<p
									class="text-[11px] font-medium tabular-nums tracking-tight text-foreground/42 sm:text-[12px]"
								>
									≈ 240&nbsp;€/h
								</p>
							</div>
							<div class="flex flex-col items-center gap-1 lg:items-start lg:text-left">
								<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/50">
									Enterprise
								</p>
								<p class="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
									5&nbsp;€/min
								</p>
								<p
									class="text-[11px] font-medium tabular-nums tracking-tight text-foreground/42 sm:text-[12px]"
								>
									≈ 300&nbsp;€/h
								</p>
							</div>
						</div>
					</div>
				</div>
				<div
					class="mx-auto mt-8 flex w-full max-w-none flex-col items-center gap-4 border-t border-border/35 pt-5 text-center"
				>
					<p
						class="max-w-xl text-[12px] font-medium leading-snug text-foreground/58 sm:text-[13px]"
					>
						Du zahlst immer nur die Minuten, die du Samuel &amp; Daniel für Skill‑Tuning tatsächlich
						genutzt hast.
					</p>
					<a
						href="/waitlist?intent=skill-tuning"
						class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border/60 bg-white/55 px-6 text-[12px] font-semibold text-foreground transition-colors hover:bg-white/85"
					>
						Request Skill Tuning</a
					>
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
						<h3 class="mt-2 text-lg font-semibold text-foreground sm:text-xl">AvenOS</h3>
						<p class="mt-1 text-[11px] leading-snug text-foreground/55 sm:text-[12px]">
							Open‑Source‑Stack zum Selbsthosten
						</p>
						<p class="mt-1 text-lg font-semibold tabular-nums text-foreground">0&nbsp;€</p>
						<ul
							class="mt-5 space-y-2 border-t border-border/30 pt-5 text-[13px] leading-snug text-foreground/72"
							aria-label="AvenOS Übersicht"
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
							<strong class="font-semibold text-foreground/85">Self‑Hosting über AvenOS</strong>
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
						AvenOS auf GitHub</a
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
		Aven Maia · AvenOS
	</footer>
</div>

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
