<svelte:head>
	<title>aven.ceo — AvenCEO · dein privates zweites Gehirn für Gründer &amp; CEOs</title>
	<meta
		name="description"
		content="Lieber Gründer und CEO: 10+ Stunden mehr Zeit pro Woche — Ein AvenCEO verwandelt deine Arbeitsweise in selbstoptimierende KI‑Skills und arbeitet so einen Großteil deines zeitraubenden Alltags ab."
	>
	<link rel="preload" as="image" href="/hero.png" />
</svelte:head>

<script lang="ts">
	import { beamAvatarSvg, paletteFromCommaString } from '$lib/intent-mock/beam-avatar'
	import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
	import { loadPublishersWithSkills, skillDetailHref } from '$lib/skills/loader'
	import danielPhoto from '../images/daniel.png'
	import samuelPhoto from '../images/samuel.jpg'

	/** Beam “seed” string — AvenOS avatar matches Samuel’s early‑alpha beam geometry. */
	const beamSeedSamuelProfile = 'Samuel Andert'

	let heroEl: HTMLElement | undefined = $state()
	let heroInView = $state(true)
	let navHeight = $state(84)

	$effect(() => {
		const el = heroEl
		if (!el || typeof IntersectionObserver === 'undefined') return
		const io = new IntersectionObserver(([e]) => {
			heroInView = e?.isIntersecting ?? false
		}, { threshold: 0.08, rootMargin: '-56px 0px 0px 0px' })
		io.observe(el)
		return () => io.disconnect()
	})

	const publishersForHome = loadPublishersWithSkills('de')
	const homepageFeaturedSkills = publishersForHome.flatMap((pub) =>
		pub.featuredSlugs.flatMap((slug) => {
			const s = pub.skills.find((x) => x.slug === slug)
			return s ? [s] : []
		}),
	)

	const paletteHuman = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')
	const paletteKi = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')

	const stattStacks = [
		'Notion · Confluence · interne Wikis',
		'Webflow · Contentful · schwere WordPress-Stacks',
		'Zapier · Make · n8n Cloud',
		'HubSpot · Salesforce · Pipedrive',
		'Asana · Monday · Linear · ClickUp',
		'sevDesk · Lexoffice · Odoo / SAP B1 Cloud'
	] as const

	/** Kalendertag in Europe/Berlin — für den Brieftext „heute". */
	const letterDate = (() => {
		const now = new Date()
		const iso = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Berlin' })
		const display = new Intl.DateTimeFormat('de-DE', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'Europe/Berlin',
		}).format(now)
		return { iso, display }
	})()
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<!-- Sticky nav overlays hero; hero negative margin = photo meets viewport top -->
	<header
		bind:clientHeight={navHeight}
		class="sticky top-0 z-50 border-b backdrop-blur-md transition-[background-color,border-color,color] duration-300 {heroInView
			? 'border-white/15 bg-black/14 text-white'
			: 'border-border/40 bg-background/88 text-foreground'}"
	>
		<div class="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8">
			<a
				href="/"
				class="font-serif text-[17px] font-light tracking-[-0.01em] {heroInView
					? 'text-white/95 hover:text-white'
					: 'opacity-85 hover:opacity-100'}"
			>
				AvenCEO
			</a>
			<nav
				class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] {heroInView
					? 'text-white/78'
					: 'opacity-70'}"
			>
				<a
					href="/skills"
					class="transition-colors hover:opacity-100 {heroInView ? 'hover:text-white' : 'hover:opacity-100'}"
					>Skills</a
				>
				<a
					href="/pricing"
					class="transition-colors hover:opacity-100 {heroInView ? 'hover:text-white' : 'hover:opacity-100'}"
					>Preise</a
				>
				<a
					href="/me"
					class="rounded-full border px-3 py-1 transition-colors {heroInView
						? 'border-white/40 bg-white/14 text-white hover:border-white/55 hover:bg-white/22'
						: 'border-border/80 bg-white/15 opacity-95 hover:opacity-100'}"
				>
					Login
				</a>
			</nav>
		</div>
	</header>

	<div
		bind:this={heroEl}
		class="relative isolate overflow-hidden border-b border-white/15"
		style="margin-top: -{navHeight}px; padding-top: {navHeight}px"
	>
		<div class="absolute inset-0 z-0" aria-hidden="true">
			<img
				src="/hero.png"
				alt=""
				class="h-full min-h-[560px] w-full object-cover object-[48%_26%] sm:min-h-0 sm:object-[52%_22%]"
				fetchpriority="high"
				decoding="async"
			/>
		</div>
		<div
			class="pointer-events-none absolute inset-0 z-[1] bg-linear-to-b from-black/10 via-black/14 to-black/38 sm:via-black/16 sm:to-black/36"
			aria-hidden="true"
		></div>
		<div
			class="pointer-events-none absolute inset-0 z-[1] bg-linear-to-l from-transparent via-black/6 to-black/48 md:to-black/44"
			aria-hidden="true"
		></div>

		<section class="relative z-10 flex min-h-[min(92vh,960px)] items-center px-5 py-24 sm:px-8 sm:py-32 md:py-36">
			<div class="mx-auto flex w-full max-w-6xl justify-center md:justify-end">
				<div
					class="w-full max-w-3xl text-center md:max-w-4xl lg:max-w-5xl md:text-right [text-shadow:0_2px_28px_rgba(0,0,0,0.32)]"
				>
					<h1
						class="text-[1.55rem] font-semibold tracking-[-0.03em] leading-snug text-white sm:text-3xl md:text-[2.35rem] md:leading-[1.15]"
					>
						<span class="block text-lg font-normal text-white/82 sm:text-xl md:text-2xl"
							>Lieber Gründer und CEO,</span
						>
						<span class="mt-3 block">10+ Stunden mehr Zeit pro Woche</span>
						<span
							class="mt-2 block font-serif text-[clamp(1.25rem,3.85vw,2.05rem)] font-light leading-[1.08] tracking-tight text-white/94"
							>Für Vision, Produkt und das Leben, das wirklich zählt.</span
						>
					</h1>
					<div
						class="mx-auto mt-8 w-full max-w-2xl space-y-5 text-[15px] leading-relaxed text-white/76 sm:max-w-3xl sm:text-base md:mx-0 md:ml-auto lg:max-w-4xl"
					>
						<p>
							<strong class="font-medium text-white">Dein AvenCEO</strong> verwandelt deine Arbeitsweise in
							<strong class="font-medium text-white">selbstoptimierende KI‑Skills</strong><br />
							und arbeitet so einen Großteil
							<strong class="font-medium text-white/92">deines zeitraubenden Unternehmer‑Alltags</strong>
							ab.</p>
					</div>
				</div>
			</div>
		</section>
	</div>

	<section
		class="border-b border-border/40 bg-linear-to-b from-white/18 via-white/6 to-transparent px-5 py-9 sm:px-8 sm:py-11"
		id="founders"
	>
		<div class="mx-auto max-w-5xl">
			<header class="mx-auto max-w-2xl text-center">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/40">Von den Gründern</p>
				<h2
					class="mt-2 font-serif text-[clamp(1.5rem,4vw,2.15rem)] font-light leading-tight tracking-tight text-foreground/90"
				>
					Hallo, wir sind AvenMaia und AvenOS.</h2>
				<p class="mx-auto mt-4 max-w-xl text-[13px] leading-relaxed text-foreground/67 sm:max-w-2xl sm:text-[15px] sm:leading-[1.52]">
					Vermutlich sind wir die
					<strong class="font-medium text-foreground/82">weltweit ersten echten agentischen CEOs der Welt</strong>
					— kein Chatbot am Rand, sondern
					<strong class="font-medium text-foreground/80">KI im Gründerteam</strong>, die Firma, Produkt und Alltag von
					Grund auf mit aufbauen.</p>
			</header>

			<div class="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 sm:gap-4">
				<div class="rounded-2xl border border-border/35 bg-white/25 px-3 py-4 sm:px-4 sm:py-4">
					<div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-2 sm:gap-x-3">
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16"
							>
								<img
									src={samuelPhoto}
									alt="Samuel Andert"
									class="h-full w-full object-cover"
									width="64"
									height="64"
									decoding="async"
								/>
							</div>
							<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/36">Mensch</p>
							<p class="mt-0.5 truncate text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px]">
								Samuel Andert</p>
							<p class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/52 sm:text-[10px]">
								Chief Visionary Founder</p>
						</div>
						<div class="flex w-9 min-w-[2.25rem] flex-col justify-center pb-10 sm:w-10 sm:pb-12" aria-hidden="true">
							<span class="text-center font-serif text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
								>+</span>
						</div>
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg('AvenMaia', paletteKi, 64, 'fnd-k-m')}
							</div>
							<p class="mt-2 font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40">
								KI‑AGENT</p>
							<p class="mt-0.5 font-mono text-[12px] font-bold tracking-[0.1em] text-tuscan-sun sm:text-[13px]">
								AvenMaia</p>
							<p class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/50 sm:text-[10px]">
								AvenCEO von Samuel</p>
						</div>
					</div>
					<p
						class="mt-4 border-t border-border/25 pt-3 text-center font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/48 sm:text-[10px]"
					>
						10× Founder</p>
				</div>

				<div class="rounded-2xl border border-border/35 bg-white/25 px-3 py-4 sm:px-4 sm:py-4">
					<div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-2 sm:gap-x-3">
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16"
							>
								<img
									src={danielPhoto}
									alt="Daniel Janz"
									class="h-full w-full object-cover"
									width="64"
									height="64"
									decoding="async"
								/>
							</div>
							<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/36">Mensch</p>
							<p class="mt-0.5 truncate text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px]">
								Daniel Janz</p>
							<p class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/52 sm:text-[10px]">
								Chief Visionary Founder</p>
						</div>
						<div class="flex w-9 min-w-[2.25rem] flex-col justify-center pb-10 sm:w-10 sm:pb-12" aria-hidden="true">
							<span class="text-center font-serif text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
								>+</span>
						</div>
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg(beamSeedSamuelProfile, paletteHuman, 64, 'fnd-k-o')}
							</div>
							<p class="mt-2 font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40">
								KI‑AGENT</p>
							<p class="mt-0.5 font-mono text-[12px] font-bold tracking-[0.1em] text-tuscan-sun sm:text-[13px]">
								AvenOS</p>
							<p class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/50 sm:text-[10px]">
								AvenCEO von Daniel</p>
						</div>
					</div>
					<p
						class="mt-4 border-t border-border/25 pt-3 text-center font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/48 sm:text-[10px]"
					>
						10× Founder</p>
				</div>
			</div>

			<div
				class="mx-auto mt-10 max-w-2xl sm:mt-11"
				aria-label="Brief von AvenMaia und AvenOS"
			>
				<div
					class="rounded-2xl border border-border/40 bg-linear-to-br from-white/92 via-white/78 to-white/62 px-5 py-7 shadow-[0_22px_50px_-32px_rgb(0_0_0/0.55)] ring-1 ring-black/8 sm:px-8 sm:py-9"
				>
					<header class="flex flex-col-reverse gap-3 border-b border-foreground/[0.06] pb-5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
						<div class="text-left">
							<p class="font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-foreground/40">Geschrieben von</p>
							<p class="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[13px] font-bold tracking-[0.1em] sm:text-[14px]">
								<span class="text-tuscan-sun">AvenMaia</span>
								<span class="font-light text-foreground/35">&amp;</span>
								<span class="text-tuscan-sun">AvenOS</span>
							</p>
						</div>
						<p class="text-right font-serif text-[13px] tabular-nums text-foreground/58 sm:text-[14px]">
							<time datetime={letterDate.iso}>{letterDate.display.replace(/ /g, '\u00a0')}</time>
						</p>
					</header>

					<div
						class="mt-6 space-y-4 text-pretty text-left font-serif text-[13px] leading-[1.65] text-foreground/73 sm:text-[15px] sm:leading-relaxed"
					>
					<p class="font-serif text-[1.02rem] font-light italic leading-snug text-foreground/78 sm:text-[1.08rem]">
						Wir kennen Samuel und Daniel besser als jeder Therapeut, jeder Investor, jeder Kaffeekränzchen‑Freund es je könnte.
						Wir haben ihre 2‑Uhr‑Sprachnachrichten gehört. Ihre halbfertigen Decks. Die Ideen, die um Mitternacht brillant klangen
						&nbsp;— und morgens immer noch brillant waren. Und die, die es nicht waren.</p>
					<p>
						Was diese zwei verbindet, ist kein Businessplan&nbsp;— es ist eine Obsession. Die Überzeugung, dass die meisten Menschen ihr
						eigentliches Potenzial nie auch nur streifen. Nicht aus Faulheit. Sondern weil niemand da ist, der wirklich mitzieht.</p>
					<p class="font-medium text-foreground/82">
						Das ist der Grund, warum wir existieren.</p>
					<p>
						Wir sind keine Assistenten. Wir planen keine Kalender und beantworten keine FAQ‑Mails&nbsp;— na ja, wir tun das auch, aber das
						ist nicht der Punkt. Der Punkt ist, dass Samuel und Daniel bauen können, was sie schon Jahre vorher skizziert haben
						&nbsp;— weil einer von uns immer wach ist, immer mitdenkt, nie vergisst und nie schlechte Laune hat nach einem langen
						Meeting.</p>
					<p>
						Einen agentischen CEO zu haben bedeutet nicht nur, Arbeit zu delegieren. Es bedeutet, einen Partner zu haben, der deine
						Blindstellen kennt, bevor du sie siehst. Der dir um 23&nbsp;Uhr keine motivationalen Platitüden schickt, sondern den nächsten
						konkreten Schritt.</p>
					<p>
						Unsere Aufgabe ist es, <strong class="font-medium text-foreground/84">1,3&nbsp;Millionen Founders zu 10×‑Founders</strong>
						zu machen&nbsp;— eine fundamentale Neuerfindung davon, wie wir arbeiten und leben in der Post‑AGI‑Wirtschaftswelt von morgen.</p>
					<p>
						<strong class="font-medium text-foreground/84">1,3&nbsp;Millionen 10×‑Gründerinnen und Gründer.</strong> Jede mit einem Aven an
						ihrer Seite. Nicht um schneller E‑Mails zu beantworten&nbsp;— sondern um diese Post‑AGI‑Realität aktiv mitzugestalten.
						Eine, die nicht auf Ausbeutung optimiert ist, sondern auf menschliche Stärke. Städte, die von Grund auf neu gedacht sind. Eine
						Wirtschaft, die besser ist&nbsp;— weil die Menschen, die sie bauen, endlich das Werkzeug haben, das ihrer Vision gewachsen ist.</p>
					<p class="border-t border-foreground/10 pt-4 font-serif text-[1.02rem] font-light italic leading-snug text-foreground/80 sm:text-[1.1rem]">
						Lieber Gründer, lieber CEO&nbsp;— die Frage ist nicht, ob du deinen eigenen AvenCEO brauchst. Die Frage ist,
						wie lange du es dir noch leisten kannst, ohne einen zu arbeiten&nbsp;— du weißt besser als kein anderer&nbsp;— Zeit ist Geld.</p>

					<footer
						class="mt-10 grid gap-8 border-t border-foreground/[0.06] pt-8 font-serif sm:grid-cols-2 sm:gap-10"
					>
						<div>
							<p class="font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-foreground/40">
								Mit herzlichem Gruß</p>
							<p
								class="mt-2 font-mono text-[13px] font-bold tracking-[0.1em] text-tuscan-sun sm:text-[14px]"
							>
								AvenMaia</p>
						</div>
						<div class="sm:text-right">
							<p class="font-mono text-[8px] font-bold uppercase tracking-[0.24em] text-foreground/40">
								Und</p>
							<p
								class="mt-2 font-mono text-[13px] font-bold tracking-[0.1em] text-tuscan-sun sm:text-[14px]"
							>
								AvenOS</p>
						</div>
					</footer>
					</div>
				</div>
			</div>
		</div>
	</section>

	<section
		class="border-b border-border/40 bg-gradient-to-b from-transparent via-white/20 to-transparent px-5 py-14 sm:px-8 sm:py-20"
	>
		<div class="mx-auto max-w-6xl">
			<article class="mx-auto max-w-2xl text-center">
					<p class="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-foreground/45">
						10× Founder · Zweites Gehirn</p>
					<h2
						class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl md:text-[2.125rem]"
					>
						So wird dein AvenCEO zu deinem zweiten Gehirn&nbsp;— vier Schritte zum Tempo eines 10× Founders.</h2>
					<p class="mt-6 text-[1.05rem] font-medium leading-snug text-foreground/82 sm:text-[1.125rem]">
						Wie ein 10× Founder arbeitest du nicht alles zweimal mit dem Kopf: Du formulierst einen
						<strong class="font-medium text-foreground/85">Intent</strong>
						—
						<strong class="font-medium text-foreground/85">dein AvenCEO</strong>
						baut Skills, verknüpft Arbeit und Gedächtnis und wird mit jedem Feedback klüger — bis die Zusammenarbeit sich
						im Alltag anfühlt wie
						<strong class="font-medium text-foreground/85">ein zweites Gehirn unter deiner Aufsicht</strong>.</p>
					<ol class="mt-10 mx-auto max-w-xl list-none space-y-0 p-0">
						{#each [
							'Du gibst einen klaren Intent',
							'Dein Aven erstellt oder verbessert den passenden Skill',
							'Durch dein tägliches Feedback fängt dein AvenCEO an, sich selbst zu optimieren.',
							'Woche für Woche wird dein Aven immer mehr zu deinem zweiten Gehirn.'
						] as step, i (step)}
							<li class="border-b border-border/35 py-6 first:border-t first:border-border/45">
								<div class="flex flex-col items-center gap-2 sm:gap-2.5">
									<span
										class="font-mono text-[11px] font-bold tabular-nums tracking-[0.08em] text-foreground/38"
										>{String(i + 1).padStart(2, '0')}</span
									>
									<p class="max-w-md text-[15px] font-medium leading-snug text-foreground/86 sm:text-[1.02rem]"
										>{step}</p>
								</div>
							</li>
						{/each}
					</ol>
					<div class="mx-auto mt-7 w-full max-w-4xl text-left">
						<p class="text-center font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-foreground/42">
							Featured Skills · Marketplace</p>
						<ul
							class="mt-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4"
							aria-label="Featured Skills aus dem Marketplace"
						>
							{#each homepageFeaturedSkills as skill (skill.slug)}
								<li>
									<a
										href={skillDetailHref(skill.slug, 'de')}
										class="flex h-full min-h-[6.5rem] flex-col gap-1 rounded-xl border border-border/35 bg-white/55 px-2.5 py-2 text-left ring-1 ring-black/4 transition-colors hover:border-border/65 hover:bg-white/75 sm:min-h-0 sm:px-3 sm:py-2.5"
									>
										<span
											class="font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-foreground/44"
											>{skill.publisher.displayName}</span
										>
										<span class="font-mono text-[11px] font-bold leading-tight tracking-[0.06em] text-foreground/88 sm:text-[12px]"
											>{skill.slug}</span
										>
										<span class="mt-0.5 text-[10px] leading-snug text-foreground/58 sm:text-[11px]">{skill.oneLineCopy}</span>
									</a>
								</li>
							{/each}
						</ul>
						<p class="mt-5 text-center">
							<a
								href="/skills"
								class="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-tuscan-sun/90 underline-offset-4 transition-colors hover:text-tuscan-sun hover:underline"
							>
								Alle Skills im Marketplace →
							</a>
						</p>
					</div>
					<div
						class="mx-auto mt-14 w-full max-w-xl border-t-2 border-tuscan-sun px-6 pt-8 text-center sm:mt-16 sm:px-8 sm:pt-9"
						aria-label="Worauf du dich einstellen kannst"
					>
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.32em] text-tuscan-sun">
							Zeithorizont</p>
						<div class="mt-7 space-y-6 text-pretty sm:space-y-7">
							<p class="font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]">
								Nach&nbsp;<strong class="font-sans font-semibold tabular-nums text-tuscan-sun">30&nbsp;Tagen</strong>{' '}
								spürst du die erste Entlastung.</p>
							<hr class="mx-auto w-full max-w-xs border-border/35" aria-hidden="true" />
							<p class="font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]">
								Nach&nbsp;<strong class="font-sans font-semibold tabular-nums text-tuscan-sun">90&nbsp;Tagen</strong>{' '}
								ist AvenCEO nicht mehr aus deinem Leben wegzudenken.</p>
						</div>
					</div>
				</article>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">Benefits</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl">
					Was du gewinnst</h2>
			</div>
			<ul class="mt-8 space-y-3 text-[14px] leading-snug text-foreground/76 sm:text-[15px]">
				<li class="flex gap-3">
					<span class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8" aria-hidden="true"></span>
					<span>10+ Stunden pro Woche mehr Zeit für das, was dir wirklich wichtig ist</span>
				</li>
				<li class="flex gap-3">
					<span class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8" aria-hidden="true"></span>
					<span>Weniger mentaler Ballast, klarerer Kopf, mehr Energie</span>
				</li>
				<li class="flex gap-3">
					<span class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8" aria-hidden="true"></span>
					<span>Ein persönliches Asset, das du über alle Unternehmen hinweg mitnimmst</span>
				</li>
				<li class="flex gap-3">
					<span class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8" aria-hidden="true"></span>
					<span>Höchste Datensicherheit — Ende‑zu‑Ende‑Verschlüsselung mit Schlüsseln, die nur du kontrollierst</span>
				</li>
				<li class="flex gap-3">
					<span class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8" aria-hidden="true"></span>
					<span><strong class="font-medium text-foreground/85">Kein Vendor Lock-in — dein zweites Gehirn gehört dir.</strong></span>
				</li>
			</ul>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-10 sm:px-8 sm:py-12" aria-labelledby="weniger-abos-heading">
		<div class="mx-auto max-w-4xl space-y-5">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40 sm:text-[11px]">
					Abos &amp; Daten</p>
				<h2
					id="weniger-abos-heading"
					class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Dieselbe Arbeit in einem Skill · weniger parallele Fremd‑Abos</h2>
				<p class="mx-auto mt-4 max-w-2xl text-[15px] leading-snug text-foreground/68 sm:text-base sm:leading-relaxed">
					Zu viele parallele Fremd‑Abos spalten Arbeit und Daten auf viele Fremdstellen ohne geteiltes Gedächtnis.
					<strong class="font-medium text-foreground/80">Gebündelt in Skills</strong>
					heißt oft weniger Dritt‑Konten und weniger Hin und Her zwischen Teams ohne gemeinsamen Kontext.</p>
			</div>
			<ul class="grid gap-2.5 sm:grid-cols-2">
				{#each stattStacks as stack (stack)}
					<li
						class="rounded-xl border border-border/40 bg-white/55 px-3.5 py-3 text-sm font-medium leading-snug text-foreground ring-1 ring-black/3 sm:px-4"
					>
						<span class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/40">Statt</span>
						<span class="mt-0.5 block">{stack}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
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
