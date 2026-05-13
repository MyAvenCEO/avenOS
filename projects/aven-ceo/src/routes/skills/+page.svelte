<svelte:head>
	<title>Skills Marketplace — aven.ceo · Aven Skills</title>
	<meta
		name="description"
		content="Skills, die echte Probleme lösen — gebaut von AvenOS und AvenMaia, installierbar für deinen Aven."
	>
</svelte:head>

<script lang="ts">
	import { beamAvatarSvg, paletteFromCommaString } from '$lib/intent-mock/beam-avatar'
	import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
	import SkillMarketplaceCard from '$lib/components/SkillMarketplaceCard.svelte'
	import { loadPublishersWithSkills, loadSkills, skillDetailHref } from '$lib/skills/loader'

	const skills = loadSkills('de')
	const publishersData = loadPublishersWithSkills('de')

	let filterAvenos = $state(true)
	let filterAvenmaia = $state(true)

	function pubVisible(id: 'avenos' | 'avenmaia') {
		return id === 'avenos' ? filterAvenos : filterAvenmaia
	}

	const visibleSkills = $derived(
		skills.filter((s) => pubVisible(s.publisher.id)),
	)

	const spotlightSlugSet = $derived.by(() => {
		const set = new Set<string>()
		for (const pub of publishersData) {
			if (!pubVisible(pub.id)) continue
			for (const slug of pub.featuredSlugs) set.add(slug)
		}
		return set
	})

	const catalogSkills = $derived(visibleSkills.filter((s) => !spotlightSlugSet.has(s.slug)))

	const chainSteps = [
		{ slug: 'email-ingestor', label: 'E‑Mail', description: 'Liest & klassifiziert' },
		{ slug: 'document-extractor', label: 'Dokumente', description: 'OCR & Extraktion' },
		{ slug: 'brain-memorizer', label: 'Gedächtnis', description: 'Identität & Kontext' },
		{ slug: 'book-keeper', label: 'Buchhaltung', description: 'Matching & Buchung' },
	]
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<!-- Sticky header -->
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8">
			<a href="/" class="font-serif text-[17px] font-light tracking-[-0.01em] opacity-85 hover:opacity-100">
				AvenCEO
			</a>
			<nav class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">
				<a href="/skills" class="opacity-100 transition-opacity">Skills</a>
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

	<!-- Hero -->
	<section class="border-b border-border/40 px-5 py-24 sm:px-8 sm:py-32 md:py-40">
		<div class="mx-auto max-w-3xl text-center">
			<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
				Skill Marketplace · Aven
			</p>
			<h1 class="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em] text-pretty leading-snug text-foreground sm:text-3xl md:text-[2.35rem] md:leading-[1.15]">
				Aven Skills, die echte Probleme lösen.
				<span class="mt-2 block font-serif text-[clamp(1.25rem,3.85vw,2.05rem)] font-light leading-[1.08] tracking-tight text-foreground/88">
					Weil wir als Founder sie selbst haben.
				</span>
			</h1>
			<p class="mx-auto mt-8 max-w-2xl text-[15px] leading-relaxed text-foreground/70 sm:text-base">
				Diese Skills haben wir für unsere eigenen Alltage gebaut — und dogfooden sie täglich.
				Heute sind sie installierbar für deinen Aven. Kein Aufpreis. Kein Lock‑in.
				{' '}
				<strong class="font-medium text-foreground/85">Dein Aven. Deine Daten. Dein Stack.</strong>
			</p>
		</div>
	</section>

	<!-- Marketplace: sidebar + featured + catalog -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
		<div class="mx-auto flex max-w-6xl flex-col gap-10 lg:flex-row lg:gap-12">
			<!-- Filters -->
			<aside class="lg:w-56 lg:shrink-0">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/35">Filter</p>
				<p class="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-foreground/55">
					Publisher
				</p>
				<div class="mt-4 space-y-3">
					{#each publishersData as pub (pub.id)}
						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border border-border/35 bg-white/55 p-3 ring-1 ring-black/4 transition-colors hover:border-border/55 hover:bg-white/70"
						>
							<input
								type="checkbox"
								class="mt-1 size-3.5 shrink-0 accent-tuscan-sun"
								checked={pubVisible(pub.id)}
								onchange={() => {
									if (pub.id === 'avenos') filterAvenos = !filterAvenos
									else filterAvenmaia = !filterAvenmaia
								}}
							/>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<div
										class="size-8 shrink-0 overflow-hidden rounded-full ring-1 ring-background [&>svg]:block [&>svg]:size-full"
										aria-hidden="true"
									>
										{@html beamAvatarSvg(
											pub.beamAvatarLabel,
											paletteFromCommaString(pub.paletteCsv),
											32,
											`filter-${pub.id}`,
										)}
									</div>
									<div class="min-w-0">
										<p class="font-mono text-[12px] font-bold tracking-[0.08em] text-tuscan-sun">
											{pub.displayName}
										</p>
										<p class="text-[10px] leading-snug text-foreground/48">{pub.subtitle}</p>
									</div>
								</div>
								<p class="mt-2 font-mono text-[10px] font-semibold tabular-nums text-foreground/42">
									{pub.skillCount} Skills
								</p>
							</div>
						</label>
					{/each}
				</div>
			</aside>

			<div class="min-w-0 flex-1 space-y-14">
				<!-- Featured by publisher -->
				<div class="space-y-12">
					{#each publishersData as pub (pub.id)}
						{#if pubVisible(pub.id)}
							<div>
								<div class="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-border/30 pb-4">
									<div class="flex items-center gap-3">
										<div
											class="size-11 shrink-0 overflow-hidden rounded-full ring-2 ring-background [&>svg]:block [&>svg]:size-full"
											aria-hidden="true"
										>
											{@html beamAvatarSvg(
												pub.beamAvatarLabel,
												paletteFromCommaString(pub.paletteCsv),
												44,
												`featured-head-${pub.id}`,
											)}
										</div>
										<div>
											<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/38">
												Empfohlen · {pub.displayName}
											</p>
											<h2 class="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
												Featured Skills
											</h2>
											<p class="mt-1 text-[12px] text-foreground/52">
												{pub.skillCount} Skills insgesamt · {pub.featuredSlugs.length} im Spotlight
											</p>
										</div>
									</div>
								</div>
								<div class="grid gap-4 md:grid-cols-2">
									{#each pub.featuredSlugs as fs (fs)}
										{@const sk = pub.skills.find((s) => s.slug === fs)}
										{#if sk}
											<SkillMarketplaceCard skill={sk} variant="spotlight" />
										{/if}
									{/each}
								</div>
							</div>
						{/if}
					{/each}
				</div>

				<!-- Full catalog (excludes spotlight cards to avoid duplicates) -->
				<div>
					<div class="mb-5 border-b border-border/30 pb-4">
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/38">
							Katalog
						</p>
						<h2 class="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
							Weitere Skills
						</h2>
						<p class="mt-1 text-[13px] text-foreground/55">
							{catalogSkills.length} Skill{catalogSkills.length === 1 ? '' : 's'}
							{#if visibleSkills.length !== catalogSkills.length}
								<span class="text-foreground/40">
									({visibleSkills.length} mit Spotlight)</span>
							{/if}
						</p>
					</div>
					{#if catalogSkills.length === 0}
						<p class="rounded-xl border border-border/35 bg-white/45 px-4 py-6 text-center text-[14px] text-foreground/55">
							Keine weiteren Skills für die aktuelle Auswahl — aktiviere einen Publisher im Filter.
						</p>
					{:else}
						<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
							{#each catalogSkills as skill (skill.slug)}
								<SkillMarketplaceCard skill={skill} />
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</section>

	<!-- Chain visualization -->
	<section class="border-b border-border/40 bg-gradient-to-b from-transparent via-white/20 to-transparent px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-4xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Das System
				</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Kein Skill steht allein — sie komponieren.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
					Von der ersten Mail bis zur fertigen Buchung: jeder Skill gibt seine Arbeit an den nächsten weiter.
					human-reviewer ist der HITL‑Layer — er hört immer mit.
				</p>
			</div>

			<div class="mt-10 flex flex-col items-center gap-2 sm:flex-row sm:items-stretch sm:justify-center">
				{#each chainSteps as step, i (step.slug)}
					<a
						href={skillDetailHref(step.slug, 'de')}
						class="group flex min-w-0 flex-col items-center rounded-xl border border-border/35 bg-white/55 px-4 py-4 text-center ring-1 ring-black/4 transition-colors hover:border-border/65 hover:bg-white/70 sm:w-36"
					>
						<p class="font-mono text-[10px] font-bold tracking-[0.1em] text-foreground/70 group-hover:text-foreground/90">
							{step.label}
						</p>
						<p class="mt-1 text-[11px] leading-snug text-foreground/50">{step.description}</p>
					</a>
					{#if i < chainSteps.length - 1}
						<div class="flex items-center justify-center text-foreground/30 sm:self-center" aria-hidden="true">
							<span class="text-lg sm:text-xl">→</span>
						</div>
					{/if}
				{/each}
			</div>

			<div class="mx-auto mt-6 max-w-sm rounded-xl border border-tuscan-sun/30 bg-tuscan-sun/10 px-4 py-3 text-center ring-1 ring-tuscan-sun/20">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">HITL Layer</p>
				<a
					href={skillDetailHref('human-reviewer', 'de')}
					class="mt-1 block font-mono text-[12px] font-bold tracking-[0.08em] text-foreground/75 hover:text-foreground/95"
				>
					human-reviewer
				</a>
				<p class="mt-1 text-[11px] text-foreground/52">
					Jeder Skill delegiert hierher, wenn echtes Urteilsvermögen gefragt ist.
				</p>
			</div>
		</div>
	</section>

	<!-- Bundled-pricing band -->
	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-14">
		<div class="mx-auto max-w-3xl text-center">
			<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
				Pricing
			</p>
			<h2 class="mt-3 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
				Alle {skills.length} Skills. In jedem CEO‑Plan enthalten.
			</h2>
			<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/65">
				Kein Skill‑Marktplatz‑Lock‑in. Kein Abo pro Skill. Kein Vendor, der deine Arbeitsintelligenz hält.
				Du baust auf einem Stack, der dir gehört.
			</p>
			<div class="mt-6">
				<a
					href="/pricing"
					class="inline-flex min-h-11 items-center justify-center rounded-full border border-border/60 bg-white/55 px-7 text-[13px] font-semibold text-foreground transition-colors hover:bg-white/85"
				>
					Alle Pläne ansehen →
				</a>
			</div>
		</div>
	</section>

	<!-- CTA -->
	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20">
		<div class="mx-auto max-w-2xl">
			<AvenIdCheckCta variant="banner" />
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
