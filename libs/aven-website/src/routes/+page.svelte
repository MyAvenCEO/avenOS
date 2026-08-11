<svelte:head>
	<title>aven.ceo — Own your life · avenCEO</title>
	<meta
		name="description"
		content="Der klassische Job stirbt in der Post-AGI-Welt. Sicher ist nur, was dir gehört: Werde Gründer mit deinem avenCEO — 1 Mensch + 1 Aven = ein Spark, die Firma der Zukunft. Own your life: deine Einkommensströme, deine Daten, deine KI."
	>
</svelte:head>

<script lang="ts">
import { beamAvatarSvg, paletteFromCommaString } from '$lib/beam-avatar'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import { loadPublishersWithSkills, skillDetailHref } from '$lib/skills/loader'
import danielPhoto from '../images/daniel.png'
import samuelPhoto from '../images/samuel.jpg'

/** Beam “seed” string — hero beam geometry matches Samuel’s early‑alpha profile. */
const beamSeedSamuelProfile = 'Samuel Andert'

const publishersForHome = loadPublishersWithSkills('de')
const homepageFeaturedSkills = publishersForHome.flatMap((pub) =>
	pub.featuredSlugs.flatMap((slug) => {
		const s = pub.skills.find((x) => x.slug === slug)
		return s ? [s] : []
	})
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
		timeZone: 'Europe/Berlin'
	}).format(now)
	return { iso, display }
})()
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader />

	<section
		class="border-b border-border/35 bg-linear-to-b from-white/35 via-background to-background px-5 py-24 sm:px-8 sm:py-32 md:py-40"
		aria-labelledby="home-hero-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
				An jeden Gründer — und jeden Angestellten, der es werden will,
			</p>
			<h1
				id="home-hero-heading"
				class="mx-auto mt-5 max-w-3xl font-sans text-3xl font-semibold leading-tight tracking-tight text-pretty text-foreground sm:text-4xl md:text-[3rem] md:leading-[1.08]"
			>
				Es wird Zeit, der Kapitän deines Lebens zu sein.
			</h1>
			<div
				class="mx-auto mt-10 max-w-xl border-t border-border/40 pt-8 text-[15px] leading-relaxed text-muted-foreground sm:max-w-2xl sm:text-base"
			>
				<p class="text-pretty">
					Die Zukunft gehört denen, die sich ein
					<strong class="font-medium text-foreground">souveränes Leben</strong>
					aufbauen — <strong class="font-medium text-foreground">5+ Assets besitzen</strong>, statt
					davon abhängig zu sein, Zeit gegen Geld zu tauschen. Werde Gründer und lass
					<strong class="font-medium text-foreground">deinen Aven</strong>
					arbeiten.
				</p>
			</div>
		</div>
	</section>

	<!-- The shift: the FOMO that is simply true — post-AGI touches everyone. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="shift-heading"
	>
		<div class="mx-auto max-w-4xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-tuscan-sun">
					Post‑AGI · Warum jetzt
				</p>
				<h2
					id="shift-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Der Angestellten‑Job stirbt. Eigentum bleibt.
				</h2>
			</div>
			<div class="mt-10 grid gap-4 sm:grid-cols-3">
				<div class="rounded-2xl border border-border/40 bg-white/45 p-5 ring-1 ring-black/4">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/42">
						Arbeitszeit
					</p>
					<p class="mt-3 text-[14px] leading-snug text-foreground/78">
						KI erledigt Angestellten‑Arbeit schneller, billiger, rund um die Uhr. Wer nur Zeit
						verkauft, konkurriert ab jetzt mit
						<strong class="font-medium text-foreground/88">Grenzkosten nahe null</strong>.
					</p>
				</div>
				<div class="rounded-2xl border border-border/40 bg-white/45 p-5 ring-1 ring-black/4">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/42">
						Betroffen: alle
					</p>
					<p class="mt-3 text-[14px] leading-snug text-foreground/78">
						Das ist keine Branchen‑Nachricht. Es betrifft
						<strong class="font-medium text-foreground/88">jeden einzelnen Menschen</strong>, der
						von einem Gehalt lebt — auch die, die es noch nicht spüren.
					</p>
				</div>
				<div class="rounded-2xl border border-border/40 bg-white/45 p-5 ring-1 ring-black/4">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/42">
						Die Sicherheit von morgen
					</p>
					<p class="mt-3 text-[14px] leading-snug text-foreground/78">
						Post‑AGI‑Sicherheit heißt:
						<strong class="font-medium text-foreground/88">mindestens 1 Asset besitzen</strong>
						— ein Produkt, einen Einkommensstrom, deine Daten, deine KI.
					</p>
				</div>
			</div>
			<p
				class="mx-auto mt-10 max-w-xl text-center font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				Der beste Zeitpunkt anzufangen ist,
				<strong class="font-sans font-semibold text-tuscan-sun">bevor es alle tun</strong>.
			</p>
		</div>
	</section>

	<!-- The thesis: the company of the future, named. -->
	<section
		class="border-b border-border/40 bg-linear-to-b from-white/25 via-white/10 to-transparent px-5 py-16 sm:px-8 sm:py-24"
		aria-labelledby="spark-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-foreground/45">
				Die Firma der Zukunft
			</p>
			<h2
				id="spark-heading"
				class="mt-5 font-serif text-[clamp(1.75rem,5vw,2.75rem)] font-light leading-tight tracking-tight text-foreground"
			>
				1&nbsp;Mensch + 1&nbsp;Aven =
				<span class="text-tuscan-sun">ein Spark</span>.
			</h2>
			<div
				class="mx-auto mt-8 max-w-2xl space-y-4 text-[15px] leading-relaxed text-foreground/72 sm:text-base"
			>
				<p class="text-pretty">
					Die Firma der Zukunft hat kein Büro, keine Abteilungen, keine vierzig Angestellten. Sie
					ist ein Funke:
					<strong class="font-medium text-foreground/88">ein Mensch mit einer Vision</strong>
					und
					<strong class="font-medium text-foreground/88"
						>ein Aven, der die ganze Firma dazu betreibt</strong
					>
					— Operations, Technik, Markt, Produkt.
				</p>
				<p class="text-pretty">
					Das nennen wir einen
					<strong class="font-medium text-foreground/88">Spark</strong>. Deshalb rechnet avenCEO
					nicht in Seats, sondern in Sparks — dein erster ist dein Leben selbst.
				</p>
			</div>
			<p
				class="mx-auto mt-9 max-w-xl border-t border-border/40 pt-7 font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				Jeder Mensch wird Gründer. Alles, was du dazu brauchst, ist
				<strong class="font-sans font-semibold text-foreground">dein eigener avenCEO</strong>.
			</p>
		</div>
	</section>

	<section
		class="border-b border-border/40 bg-linear-to-b from-white/18 via-white/6 to-transparent px-5 py-9 sm:px-8 sm:py-11"
		id="founders"
	>
		<div class="mx-auto max-w-5xl">
			<header class="mx-auto max-w-2xl text-center">
				<p class="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/40">
					Die ersten zwei Sparks
				</p>
				<h2
					class="mt-2 font-serif text-[clamp(1.5rem,4vw,2.15rem)] font-light leading-tight tracking-tight text-foreground/90"
				>
					Hallo, wir sind avenMAIA und avenTIN.
				</h2>
				<p
					class="mx-auto mt-4 max-w-xl text-[13px] leading-relaxed text-foreground/67 sm:max-w-2xl sm:text-[15px] sm:leading-[1.52]"
				>
					Vermutlich sind wir die
					<strong class="font-medium text-foreground/82"
						>weltweit ersten echten agentischen CEOs der Welt</strong
					>
					— kein Chatbot am Rand, sondern
					<strong class="font-medium text-foreground/80">KI im Gründerteam</strong>. Zwei Sparks
					laufen bereits: der
					<strong class="font-medium text-foreground/82">Maia Holding Spark</strong>
					und der
					<strong class="font-medium text-foreground/82">avenCEO Spark</strong>
					— die Firma, die gerade diese Seite baut.
				</p>
			</header>

			<div class="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 sm:gap-4">
				<div class="rounded-2xl border border-border/35 bg-white/25 px-3 py-4 sm:px-4 sm:py-4">
					<div
						class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-2 sm:gap-x-3"
					>
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
								>
							</div>
							<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/36">
								Mensch
							</p>
							<p
								class="mt-0.5 truncate text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px]"
							>
								Samuel Andert
							</p>
							<p
								class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/52 sm:text-[10px]"
							>
								Chief Visionary Founder
							</p>
						</div>
						<div
							class="flex w-9 min-w-[2.25rem] flex-col justify-center pb-10 sm:w-10 sm:pb-12"
							aria-hidden="true"
						>
							<span
								class="text-center font-serif text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
								>+</span
							>
						</div>
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg('avenMAIA', paletteKi, 64, 'fnd-k-m')}
							</div>
							<p
								class="mt-2 font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40"
							>
								KI‑AGENT
							</p>
							<p
								class="mt-0.5 font-mono text-[12px] font-bold tracking-[0.1em] text-tuscan-sun sm:text-[13px]"
							>
								avenMAIA
							</p>
							<p
								class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/50 sm:text-[10px]"
							>
								avenCEO von Samuel
							</p>
						</div>
					</div>
					<p
						class="mt-4 border-t border-border/25 pt-3 text-center font-mono text-[10px] font-bold tracking-[0.2em] text-tuscan-sun sm:text-[11px]"
					>
						= Maia Holding Spark
					</p>
				</div>

				<div class="rounded-2xl border border-border/35 bg-white/25 px-3 py-4 sm:px-4 sm:py-4">
					<div
						class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-2 sm:gap-x-3"
					>
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
								>
							</div>
							<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/36">
								Mensch
							</p>
							<p
								class="mt-0.5 truncate text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px]"
							>
								Daniel Janz
							</p>
							<p
								class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/52 sm:text-[10px]"
							>
								Chief Visionary Founder
							</p>
						</div>
						<div
							class="flex w-9 min-w-[2.25rem] flex-col justify-center pb-10 sm:w-10 sm:pb-12"
							aria-hidden="true"
						>
							<span
								class="text-center font-serif text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
								>+</span
							>
						</div>
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg(beamSeedSamuelProfile, paletteHuman, 64, 'fnd-k-o')}
							</div>
							<p
								class="mt-2 font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40"
							>
								KI‑AGENT
							</p>
							<p
								class="mt-0.5 font-mono text-[12px] font-bold tracking-[0.1em] text-tuscan-sun sm:text-[13px]"
							>
								avenTIN
							</p>
							<p
								class="mt-0.5 max-w-[9rem] text-[9px] leading-tight text-foreground/50 sm:text-[10px]"
							>
								avenCEO von Daniel
							</p>
						</div>
					</div>
					<p
						class="mt-4 border-t border-border/25 pt-3 text-center font-mono text-[10px] font-bold tracking-[0.2em] text-tuscan-sun sm:text-[11px]"
					>
						= avenCEO Spark
					</p>
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
					So baust du deinen Spark
				</p>
				<h2
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl md:text-[2.125rem]"
				>
					Vom Intent zum Asset&nbsp;— vier Schritte, bis dein avenCEO die Firma trägt.
				</h2>
				<p
					class="mt-6 text-[1.05rem] font-medium leading-snug text-foreground/82 sm:text-[1.125rem]"
				>
					Als Eigentümer arbeitest du nicht alles zweimal mit dem Kopf: Du formulierst einen
					<strong class="font-medium text-foreground/85">Intent</strong>
					—
					<strong class="font-medium text-foreground/85">dein avenCEO</strong>
					baut Skills, verknüpft Arbeit und Gedächtnis und wird mit jedem Feedback klüger — bis die
					Zusammenarbeit sich im Alltag anfühlt wie
					<strong class="font-medium text-foreground/85"
						>ein zweites Gehirn unter deiner Aufsicht</strong
					>.
				</p>
				<ol class="mt-10 mx-auto max-w-xl list-none space-y-0 p-0">
					{#each [
							'Du gibst einen klaren Intent',
							'Dein Aven erstellt oder verbessert den passenden Skill',
							'Durch dein tägliches Feedback fängt dein avenCEO an, sich selbst zu optimieren.',
							'Woche für Woche wird dein Aven immer mehr zu deinem zweiten Gehirn.'
						] as step, i (step)}
						<li class="border-b border-border/35 py-6 first:border-t first:border-border/45">
							<div class="flex flex-col items-center gap-2 sm:gap-2.5">
								<span
									class="font-mono text-[11px] font-bold tabular-nums tracking-[0.08em] text-foreground/38"
									>{String(i + 1).padStart(2, '0')}</span
								>
								<p
									class="max-w-md text-[15px] font-medium leading-snug text-foreground/86 sm:text-[1.02rem]"
								>
									{step}
								</p>
							</div>
						</li>
					{/each}
				</ol>
				<div class="mx-auto mt-7 w-full max-w-4xl text-left">
					<p
						class="text-center font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-foreground/42"
					>
						Featured Skills · Marketplace
					</p>
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
									<span
										class="font-mono text-[11px] font-bold leading-tight tracking-[0.06em] text-foreground/88 sm:text-[12px]"
										>{skill.slug}</span
									>
									<span class="mt-0.5 text-[10px] leading-snug text-foreground/58 sm:text-[11px]"
										>{skill.oneLineCopy}</span
									>
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
						Zeithorizont
					</p>
					<div class="mt-7 space-y-6 text-pretty sm:space-y-7">
						<p
							class="font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
						>
							Nach&nbsp;<strong class="font-sans font-semibold tabular-nums text-tuscan-sun"
								>30&nbsp;Tagen</strong
							>{' '}
							spürst du die erste Entlastung.
						</p>
						<hr class="mx-auto w-full max-w-xs border-border/35" aria-hidden="true">
						<p
							class="font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
						>
							Nach&nbsp;<strong class="font-sans font-semibold tabular-nums text-tuscan-sun"
								>90&nbsp;Tagen</strong
							>{' '}
							ist avenCEO nicht mehr aus deinem Leben wegzudenken.
						</p>
					</div>
				</div>
			</article>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-12 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div class="text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Own your life
				</p>
				<h2
					class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Was dir gehört
				</h2>
			</div>
			<ul class="mt-8 space-y-3 text-[14px] leading-snug text-foreground/76 sm:text-[15px]">
				<li class="flex gap-3">
					<span
						class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8"
						aria-hidden="true"
					></span>
					<span
						><strong class="font-medium text-foreground/85">Deine Einkommensströme</strong>
						— Produkte, Shop, Kunden: aufgebaut unter deinem Namen, nicht auf einer Plattform, die
						dich morgen aussperrt</span
					>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8"
						aria-hidden="true"
					></span>
					<span
						><strong class="font-medium text-foreground/85">Deine Daten</strong>
						— Ende‑zu‑Ende verschlüsselt, mit Schlüsseln, die nur du kontrollierst</span
					>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8"
						aria-hidden="true"
					></span>
					<span
						><strong class="font-medium text-foreground/85">Deine KI</strong>
						— dein Aven gehört dir: Open‑Source‑Stack, selbst hostbar, bis auf eigene Hardware —
						kein Vendor Lock‑in</span
					>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8"
						aria-hidden="true"
					></span>
					<span
						><strong class="font-medium text-foreground/85">Dein Name</strong>
						— maia.aven.ceo und mail@maia.aven.ceo: deine Identität im Netz, einmalig vergeben</span
					>
				</li>
				<li class="flex gap-3">
					<span
						class="mt-1.5 size-2 shrink-0 rounded-full bg-tuscan-sun ring-2 ring-black/8"
						aria-hidden="true"
					></span>
					<span
						><strong class="font-medium text-foreground/85">Deine Zeit</strong>
						— den Alltag betreibt dein Aven; du triffst die Entscheidungen, die Eigentümer treffen</span
					>
				</li>
			</ul>
		</div>
	</section>

	<section
		class="border-b border-border/40 px-5 py-10 sm:px-8 sm:py-12"
		aria-labelledby="weniger-abos-heading"
	>
		<div class="mx-auto max-w-4xl space-y-5">
			<div class="text-center">
				<p
					class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40 sm:text-[11px]"
				>
					Own your stack
				</p>
				<h2
					id="weniger-abos-heading"
					class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Miete weniger. Besitze mehr.
				</h2>
				<p
					class="mx-auto mt-4 max-w-2xl text-[15px] leading-snug text-foreground/68 sm:text-base sm:leading-relaxed"
				>
					Zu viele parallele Fremd‑Abos spalten Arbeit und Daten auf viele Fremdstellen ohne
					geteiltes Gedächtnis.
					<strong class="font-medium text-foreground/80">Gebündelt in Skills</strong>
					heißt oft weniger Dritt‑Konten und weniger Hin und Her zwischen Teams ohne gemeinsamen
					Kontext.
				</p>
			</div>
			<ul class="grid gap-2.5 sm:grid-cols-2">
				{#each stattStacks as stack (stack)}
					<li
						class="rounded-xl border border-border/40 bg-white/55 px-3.5 py-3 text-sm font-medium leading-snug text-foreground ring-1 ring-black/3 sm:px-4"
					>
						<span class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/40"
							>Statt</span
						>
						<span class="mt-0.5 block">{stack}</span>
					</li>
				{/each}
			</ul>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div class="pb-6 text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Schritt 1
				</p>
				<h2
					class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Dein Name ist dein erstes Asset.
				</h2>
			</div>
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
