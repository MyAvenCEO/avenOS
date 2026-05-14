<script lang="ts">
	import { beamAvatarSvg, paletteFromCommaString } from '$lib/intent-mock/beam-avatar'
	import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
	import type { AvenosSkill } from '$lib/skills/types'
	import { publisherIdentity, skillDetailHref } from '$lib/skills/loader'

	type Props = {
		skill: AvenosSkill
	}

	let { skill }: Props = $props()

	const pubIdentity = $derived(publisherIdentity(skill.publisher.id, 'de'))
	const paletteKi = $derived(paletteFromCommaString(pubIdentity.paletteCsv))

	const slugLabels: Record<string, string> = {
		'email-ingestor': 'email-ingestor',
		'document-extractor': 'document-extractor',
		'brain-memorizer': 'brain-memorizer',
		'book-keeper': 'book-keeper',
		'human-reviewer': 'human-reviewer',
		'blog-writer': 'blog-writer',
		'golden-offer': 'golden-offer',
	}
</script>

<svelte:head>
	<title>{skill.slug} — aven.ceo · {skill.publisher.displayName} Skills</title>
	<meta name="description" content={skill.oneLineCopy} />
</svelte:head>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<!-- Sticky header -->
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8">
			<a href="/" class="font-serif text-[17px] font-light tracking-[-0.01em] opacity-85 hover:opacity-100">
				AvenCEO
			</a>
			<nav class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">
				<a href="/skills" class="transition-opacity hover:opacity-100">Skills</a>

				<a href="/pricing" class="transition-opacity hover:opacity-100">Preise</a>
				<a
					href="/me"
					class="rounded-full border border-border/80 bg-white/15 px-3 py-1 opacity-95 hover:opacity-100 transition-opacity"
				>
					Login
				</a>
			</nav>
		</div>
	</header>

	<!-- 1. WHY — Daniel scenario -->
	<section class="border-b border-border/40 px-5 py-24 sm:px-8 sm:py-32 md:py-40">
		<div class="mx-auto max-w-3xl text-center">
			<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
				{skill.hero.kicker}
			</p>
			<h1 class="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em] text-pretty leading-snug text-foreground sm:text-3xl md:text-[2.35rem] md:leading-[1.15]">
				{skill.hero.headlineMain}
				<span class="mt-2 block font-serif text-[clamp(1.25rem,3.85vw,2.05rem)] font-light leading-[1.08] tracking-tight text-foreground/88">
					{skill.hero.headlineSerifLead}
				</span>
			</h1>
			<div class="mx-auto mt-8 max-w-xl">
				<div class="rounded-2xl border border-border/35 bg-white/55 px-5 py-5 text-left ring-1 ring-black/4 sm:px-6 sm:py-6">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/38">
						{skill.founderScenario.timestamp} · {skill.publisher.founderName}s Realität
					</p>
					<p class="mt-3 font-serif text-[15px] italic leading-relaxed text-foreground/75 sm:text-[16px]">
						"{skill.founderScenario.story}"
					</p>
					<div class="mt-4 flex items-center gap-2 border-t border-border/25 pt-3">
						<div
							class="size-6 shrink-0 overflow-hidden rounded-full ring-1 ring-background [&>svg]:block [&>svg]:size-full"
							aria-hidden="true"
						>
							{@html beamAvatarSvg(pubIdentity.beamAvatarLabel, paletteKi, 32, `skill-pub-${skill.slug}`)}
						</div>
						<p class="font-mono text-[9px] font-bold tracking-[0.14em] text-tuscan-sun">{skill.publisher.displayName}</p>
						<p class="font-mono text-[9px] text-foreground/40">hat das gelöst.</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- 2. WAS DU GEWINNST — benefits first -->
	<section class="border-b border-border/40 bg-linear-to-b from-white/18 via-white/6 to-transparent px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Was du gewinnst
				</p>
			<h2 class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl">
				Dein Leben nach {skill.slug}.
				</h2>
				<p class="mx-auto mt-3 max-w-md font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-tuscan-sun">
					{skill.hero.promiseHoursPerWeek} pro Woche zurückgewonnen
				</p>
			</div>
			<ul class="mt-8 space-y-3 text-[14px] leading-snug text-foreground/76 sm:text-[15px]">
				{#each skill.benefits as benefit (benefit)}
					<li class="flex gap-3">
						<span class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8" aria-hidden="true"></span>
						<span>{benefit}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<!-- 3. HOW — plain-language steps -->
	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl text-center">
			<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
				So funktioniert es
			</p>
			<h2 class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl">
				In deinem Alltag — vier Schritte.
			</h2>
			<ol class="mt-10 mx-auto max-w-xl list-none space-y-0 p-0">
				{#each skill.howSteps as step, i (step)}
					<li class="border-b border-border/35 py-6 first:border-t first:border-border/45">
						<div class="flex flex-col items-center gap-2 sm:gap-2.5">
							<span class="font-mono text-[11px] font-bold tabular-nums tracking-[0.08em] text-foreground/38">
								{String(i + 1).padStart(2, '0')}
							</span>
							<p class="max-w-md text-[15px] font-medium leading-snug text-foreground/86 sm:text-[1.02rem]">
								{step}
							</p>
						</div>
					</li>
				{/each}
			</ol>
		</div>
	</section>

	<!-- 4. WHAT — honest mechanics -->
	<section class="border-b border-border/40 bg-gradient-to-b from-transparent via-white/20 to-transparent px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-3xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Die Mechanik
				</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Was genau passiert — ehrlich erklärt.
				</h2>
			</div>
			<div class="mt-8 grid gap-3 sm:grid-cols-3">
				<div class="rounded-xl border border-border/35 bg-white/55 px-4 py-4 ring-1 ring-black/4">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/40">Input</p>
					<p class="mt-2 text-[13px] leading-snug text-foreground/78">{skill.whatMechanics.input}</p>
				</div>
				<div class="rounded-xl border border-tuscan-sun/30 bg-tuscan-sun/10 px-4 py-4 ring-1 ring-tuscan-sun/20">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-tuscan-sun/70">Magic</p>
					<p class="mt-2 text-[13px] leading-snug text-foreground/78">{skill.whatMechanics.magic}</p>
				</div>
				<div class="rounded-xl border border-border/35 bg-white/55 px-4 py-4 ring-1 ring-black/4">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/40">Output</p>
					<p class="mt-2 text-[13px] leading-snug text-foreground/78">{skill.whatMechanics.output}</p>
				</div>
			</div>
		</div>
	</section>

	<!-- 5. PLAYS WELL WITH -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-3xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Kein Skill steht allein
				</p>
			<h2 class="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
				{skill.slug} arbeitet zusammen mit:
				</h2>
			</div>
			<ul class="mt-6 grid gap-2.5 sm:grid-cols-2">
				{#each skill.playsWith as { slug, relation } (slug)}
					<li>
						<a
							href={skillDetailHref(slug, 'de')}
							class="flex items-start gap-3 rounded-xl border border-border/35 bg-white/55 px-4 py-3 ring-1 ring-black/4 transition-colors hover:border-border/65 hover:bg-white/70"
						>
							<span class="mt-0.5 font-mono text-[11px] font-bold text-tuscan-sun">→</span>
							<div>
								<p class="font-mono text-[11px] font-bold tracking-[0.1em] text-foreground/80">
									{slugLabels[slug] ?? slug}
								</p>
								<p class="mt-0.5 text-[12px] leading-snug text-foreground/55">{relation}</p>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<!-- 6. VALUE STACK (Hormozi) -->
	<section class="border-b border-border/40 bg-linear-to-b from-transparent via-white/12 to-transparent px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Was es kosten würde
				</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Einzeln kaufen vs. einfach drin haben.
				</h2>
			</div>
			<div class="mt-8 rounded-2xl border border-border/40 bg-white/55 p-5 ring-1 ring-black/5 sm:p-7">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Standalone‑Alternativen
				</p>
				<ul class="mt-4 space-y-2">
					{#each skill.valueStack.standaloneAlternatives as alt (alt.label)}
						<li class="flex items-baseline justify-between gap-3">
							<span class="text-[13px] text-foreground/65 line-through decoration-foreground/30">{alt.label}</span>
							{#if alt.eurPerMonth > 0}
								<span class="shrink-0 font-mono text-[13px] font-bold tabular-nums text-foreground/55 line-through decoration-foreground/30">
									{alt.eurPerMonth}&nbsp;€/m
								</span>
							{:else}
								<span class="shrink-0 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-foreground/40">
									Nicht verfügbar
								</span>
							{/if}
						</li>
					{/each}
				</ul>
				<div class="mt-5 flex items-baseline justify-between border-t border-border/30 pt-4">
					<span class="text-[14px] font-semibold text-foreground/70">Gesamt standalone</span>
					<span class="font-mono text-xl font-bold tabular-nums text-foreground line-through decoration-foreground/40">
						≈ {skill.valueStack.standaloneTotalEurPerMonth}&nbsp;€/m
					</span>
				</div>
				<div class="mt-4 rounded-xl border border-tuscan-sun/40 bg-tuscan-sun/15 px-4 py-4">
					<p class="text-center font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">
						In jedem CEO‑Plan enthalten
					</p>
					<p class="mt-2 text-center text-[15px] font-bold text-foreground">
						0&nbsp;€ Aufpreis
					</p>
					<p class="mt-1 text-center text-[12px] text-foreground/60">
						Founder · Startup · Investor CEO — kein Skill‑Marktplatz‑Lock‑in
					</p>
				</div>
				<div class="mt-5 grid gap-3 border-t border-border/25 pt-5 sm:grid-cols-3">
					<div>
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/38">Erste Entlastung</p>
						<p class="mt-1 text-[13px] font-medium text-foreground/78">{skill.valueStack.timeDelayToValue}</p>
					</div>
					<div>
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/38">Setup‑Aufwand</p>
						<p class="mt-1 text-[13px] font-medium text-foreground/78">{skill.valueStack.effortToInstall}</p>
					</div>
					<div>
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/38">Beweis</p>
						<p class="mt-1 text-[13px] font-medium text-foreground/78">{skill.valueStack.proof}</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	<!-- 7. BONUSES + GUARANTEE + SCARCITY -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl space-y-6">
			<div class="rounded-2xl border border-border/40 bg-white/55 p-5 ring-1 ring-black/5 sm:p-6">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/40">Boni</p>
				<ul class="mt-3 space-y-2">
					{#each skill.bonuses as bonus (bonus)}
						<li class="flex gap-3 text-[13px] leading-snug text-foreground/76 sm:text-[14px]">
							<span class="mt-1 size-1.5 shrink-0 rounded-full bg-tuscan-sun" aria-hidden="true"></span>
							<span>{bonus}</span>
						</li>
					{/each}
				</ul>
			</div>
			<div class="rounded-xl border border-tuscan-sun/35 bg-tuscan-sun/12 px-5 py-4">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">Verfügbarkeit</p>
				<p class="mt-1.5 text-[13px] leading-snug text-foreground/75">{skill.scarcity}</p>
			</div>
		</div>
	</section>

	<!-- 8. LETTER FROM AVENOS -->
	<section class="border-b border-border/40 bg-linear-to-b from-white/18 via-white/6 to-transparent px-5 py-12 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div
				class="rounded-2xl border border-border/40 bg-linear-to-br from-white/92 via-white/78 to-white/62 px-5 py-7 shadow-[0_22px_50px_-32px_rgb(0_0_0/0.55)] ring-1 ring-black/8 sm:px-8 sm:py-9"
			>
				<header class="flex items-end justify-between gap-4 border-b border-foreground/[0.06] pb-5">
					<div class="flex items-center gap-3">
						<div
							class="size-10 shrink-0 overflow-hidden rounded-full ring-2 ring-background [&>svg]:block [&>svg]:size-full"
							aria-hidden="true"
						>
							{@html beamAvatarSvg(pubIdentity.beamAvatarLabel, paletteKi, 48, `letter-${skill.slug}`)}
						</div>
						<div>
							<p class="font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-foreground/40">Geschrieben von</p>
							<p class="mt-0.5 font-mono text-[13px] font-bold tracking-[0.1em] text-tuscan-sun">{skill.publisher.displayName}</p>
						</div>
					</div>
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-foreground/38">
						{skill.slug}
					</p>
				</header>
				<p class="mt-6 font-serif text-[15px] italic leading-relaxed text-foreground/73 sm:text-[16px] sm:leading-[1.65]">
					{skill.letterFromPublisher}
				</p>
				<footer class="mt-8 border-t border-foreground/[0.06] pt-6">
					<p class="font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-foreground/40">Mit Überzeugung,</p>
					<p class="mt-1.5 font-mono text-[13px] font-bold tracking-[0.1em] text-tuscan-sun">{skill.publisher.displayName}</p>
				</footer>
			</div>
		</div>
	</section>

	<!-- 9. CTA -->
	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<AvenIdCheckCta variant="banner" />
			<div class="mt-6 text-center">
				<a href="/skills" class="font-mono text-[12px] font-semibold uppercase tracking-[0.14em] text-foreground/50 transition-opacity hover:text-foreground/80">
					← Alle Skills ansehen
				</a>
			</div>
		</div>
	</section>

	<footer class="border-t border-border/40 px-5 py-10 sm:px-8 text-center text-[11px] font-mono text-foreground/30">
		Aven Maia · AvenOS
	</footer>
</div>

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
