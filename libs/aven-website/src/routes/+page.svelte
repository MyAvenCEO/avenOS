<svelte:head>
	<title>aven.ceo — In dir steckt so viel mehr · avenCEO</title>
	<meta
		name="description"
		content="Ein Aven ist eine KI, die dir gehört: er sortiert deine Post, führt deine Bücher und baut deine Firma mit. Von Zeit gegen Geld zu 10+ Assets, die dir gehören — und 1 Million Gründer, die gemeinsam die Startups der Zukunft bauen und besitzen."
	>
</svelte:head>

<script lang="ts">
import { beamAvatarSvg, paletteFromCommaString } from '$lib/beam-avatar'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SkillMarketplaceCard from '$lib/components/SkillMarketplaceCard.svelte'
import { loadSkills } from '$lib/skills/loader'
import danielPhoto from '../images/daniel.png'
import samuelPhoto from '../images/samuel.jpg'

/** Beam “seed” string — hero beam geometry matches Samuel’s early‑alpha profile. */
const beamSeedSamuelProfile = 'Samuel Andert'

const paletteHuman = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')
/** A taste of the marketplace: the first six skills, the full list lives at /skills. */
const skillsPreview = loadSkills('de').slice(0, 6)

const paletteKi = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader />

	<section
		class="border-b border-border/35 bg-linear-to-b from-surface-raised via-background to-background px-5 py-24 sm:px-8 sm:py-32 md:py-40"
		aria-labelledby="home-hero-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<h1
				id="home-hero-heading"
				class="mx-auto max-w-3xl font-sans text-3xl font-semibold leading-tight tracking-tight text-pretty text-foreground sm:text-4xl md:text-[3rem] md:leading-[1.08]"
			>
				Tief in deinem Herzen weißt du es:
				<span class="mt-1 block">in dir steckt so viel mehr.</span>
			</h1>
			<div class="mx-auto mt-8 max-w-2xl">
				<p class="text-pretty text-[19px] font-semibold leading-snug text-accent sm:text-[22px]">
					Wir sind da, um dich endlich in dein souveränes Gründerleben zu katapultieren, von dem du
					schon immer träumst. Gemeinsam zu bauen, woran du wirklich glaubst, ist die Zukunft, die
					uns alle glücklich macht.
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
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
					Post‑AGI · Warum jetzt
				</p>
				<h2
					id="shift-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					JETZT ist der perfekte Moment, der Creator deines vollen Lebenspotenzials zu sein.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					<strong class="font-medium text-foreground/85">Post‑AGI‑Ökonomie</strong>
					heißt: Die Basis der alten Wirtschaft —
					<strong class="font-medium text-foreground/85">Zeit gegen Geld</strong>
					— kollabiert, sobald KI fast jede Arbeit so gut erledigt wie ein Mensch: Kopfarbeit heute,
					mit Robotern bald auch Handarbeit, rund um die Uhr,
					<strong class="font-medium text-foreground/85">zum Preis von Strom</strong>. Dann bleibt
					nur eine Einkommensquelle — das, was dir gehört — und nur eine Frage:
					<strong class="font-medium text-foreground/85"
						>Besitzt du die KI, die die neue Arbeit leistet — oder nicht?</strong
					>
				</p>
			</div>

			<!-- The emotional fork: the same future, seen from both sides. -->
			<div class="mt-10 grid gap-4 sm:grid-cols-2">
				<div class="rounded-2xl bg-primary p-6 sm:p-7">
					<p class="text-[9px] font-bold uppercase tracking-[0.24em] text-primary-foreground/45">
						Ohne Assets
					</p>
					<h3 class="mt-2 text-lg font-semibold tracking-tight text-primary-foreground sm:text-xl">
						Das fremdbestimmte Drehbuch
					</h3>
					<ul class="mt-4 space-y-2.5 text-[14px] leading-snug text-primary-foreground/72">
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/25"
								aria-hidden="true"
							></span>
							<span>Deine Arbeitszeit konkurriert mit dem Preis von Strom.</span>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/25"
								aria-hidden="true"
							></span>
							<span
								>Jedes Gehalt ist ersetzbar — auch deins, auch wenn du es noch nicht spürst.</span
							>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary-foreground/25"
								aria-hidden="true"
							></span>
							<span
								>Deine Daten, deine Aufmerksamkeit, dein Alltag gehören den Plattformen anderer.</span
							>
						</li>
					</ul>
					<p
						class="mt-5 border-t border-primary-foreground/15 pt-4 text-[1.25rem] font-light leading-snug text-primary-foreground sm:text-[1.4rem]"
					>
						Dein Leben läuft nach dem Plan von jemand anderem.
					</p>
				</div>
				<div class="rounded-2xl border border-accent/45 bg-secondary p-6 sm:p-7">
					<p class="text-[9px] font-bold uppercase tracking-[0.24em] text-foreground/45">
						Mit deinen Assets
					</p>
					<h3 class="mt-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
						Das selbstbestimmte Drehbuch
					</h3>
					<ul class="mt-4 space-y-2.5 text-[14px] leading-snug text-foreground/75">
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/30"
								aria-hidden="true"
							></span>
							<span>Deine KI arbeitet rund um die Uhr — für dich, nicht für einen Konzern.</span>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/30"
								aria-hidden="true"
							></span>
							<span
								>Was du baust, gehört dir. Und an dem, was die anderen bauen, bist du beteiligt.</span
							>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/30"
								aria-hidden="true"
							></span>
							<span
								>Du gestaltest wieder: deine Vision, deine Beziehungen, das Leben, das wirklich
								zählt.</span
							>
						</li>
					</ul>
					<p
						class="mt-5 border-t border-foreground/10 pt-4 text-[1.25rem] font-light leading-snug text-foreground sm:text-[1.4rem]"
					>
						Gemeinsam etwas bauen, das dir gehört — das macht glücklich.
					</p>
				</div>
			</div>

			<p
				class="mx-auto mt-10 max-w-xl text-center text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				Beide Drehbücher beginnen heute — und du schreibst eines davon sowieso.
				<strong class="font-sans font-semibold text-accent">Nimm den Stift in die Hand.</strong>
			</p>
		</div>
	</section>

	<!-- ONE section between the hero and the Spark thesis: the day-sized change,
	     what an Aven actually is, and the thesis that ties them together. The
	     separate "Vision" block said the same thing a second time, one level of
	     abstraction higher, and the page was better without it. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="personal-heading"
	>
		<div class="mx-auto max-w-2xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
				Deine Transformation · Ganz persönlich
			</p>
			<h2
				id="personal-heading"
				class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
			>
				Erst ändert sich dein Tag. Dann dein Jahrzehnt.
			</h2>

			<p class="mx-auto mt-6 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Heute verkaufst du Stunden. Acht gehören jemand anderem, die neunte meistens auch — und was
				am Monatsende übrig bleibt, hat jemand anderes festgelegt.
			</p>

			<p
				class="mt-7 text-pretty text-[19px] font-medium leading-snug text-foreground sm:text-[21px]"
			>
				Dein Aven ist eine KI, die dir gehört und deine Privatsphäre schützt.
			</p>

			<p class="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Deiner sortiert deine Post, bevor du aufstehst. Bereitet die Rechnung vor, bevor du sie
				suchst. Erledigt den Papierkram, der dich seit Monaten anschweigt — während du an dem
				arbeitest, wofür du eigentlich angetreten bist.
			</p>

			<p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Und dann passiert das Eigentliche:
				<strong class="font-medium text-foreground/85">was du baust, bleibt deins</strong>. Nicht
				deine Stunde ist das Asset — du und dein Aven seid es.
			</p>
		</div>
	</section>

	<!-- The thesis: the company of the future, named. -->
	<section
		class="border-b border-border/40 bg-linear-to-b from-surface-soft/70 to-transparent px-5 py-16 sm:px-8 sm:py-24"
		aria-labelledby="spark-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
				Die Firma der Zukunft
			</p>
			<h2
				id="spark-heading"
				class="mt-5 text-[clamp(1.75rem,5vw,2.75rem)] font-light leading-tight tracking-tight text-foreground"
			>
				1&nbsp;Mensch + 1&nbsp;Aven =
				<span class="text-accent">ein Spark</span>.
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
					<strong class="font-medium text-foreground/88">Spark</strong>
					— dein erster ist dein Leben selbst.
				</p>
			</div>
			<p
				class="mx-auto mt-9 max-w-xl border-t border-border/40 pt-7 text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				Jeder Mensch wird Gründer.
				<span class="mt-2 block">
					Alles, was du dazu brauchst, ist
					<strong class="font-sans font-semibold text-foreground">dein eigener avenCEO</strong>.
				</span>
			</p>
		</div>
	</section>

	<section
		class="border-b border-border/40 bg-linear-to-b from-surface-soft/50 to-transparent px-5 py-9 sm:px-8 sm:py-11"
		id="founders"
	>
		<div class="mx-auto max-w-5xl">
			<header class="mx-auto max-w-2xl text-center">
				<p class="text-[9px] font-bold uppercase tracking-[0.26em] text-accent">
					Die ersten zwei Sparks
				</p>
				<h2
					class="mt-2 text-[clamp(1.5rem,4vw,2.15rem)] font-light leading-tight tracking-tight text-foreground/90"
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
				<div
					class="rounded-2xl border border-foreground/8 bg-surface-raised px-3 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:px-4 sm:py-4"
				>
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
								class="text-center text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
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
							<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40">
								KI‑AGENT
							</p>
							<p class="mt-0.5 text-[12px] font-bold tracking-[0.1em] text-accent sm:text-[13px]">
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
						class="mt-4 border-t border-border/25 pt-3 text-center text-[10px] font-bold tracking-[0.2em] text-accent sm:text-[11px]"
					>
						= Maia Holding Spark
					</p>
				</div>

				<div
					class="rounded-2xl border border-foreground/8 bg-surface-raised px-3 py-4 shadow-[0_1px_3px_rgba(30,41,59,0.05)] sm:px-4 sm:py-4"
				>
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
								class="text-center text-2xl font-light leading-none text-foreground/30 sm:text-[1.75rem]"
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
							<p class="mt-2 text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40">
								KI‑AGENT
							</p>
							<p class="mt-0.5 text-[12px] font-bold tracking-[0.1em] text-accent sm:text-[13px]">
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
						class="mt-4 border-t border-border/25 pt-3 text-center text-[10px] font-bold tracking-[0.2em] text-accent sm:text-[11px]"
					>
						= avenCEO Spark
					</p>
				</div>
			</div>
		</div>
		<p
			class="mx-auto mt-8 max-w-xl text-pretty text-[16px] leading-relaxed text-foreground/72 sm:text-[17px]"
		>
			Und jetzt stell dir vor, eine Million Menschen bauen ihren Spark — gemeinsam.
			<strong class="font-medium text-accent">Was können wir damit alles erreichen?</strong>
		</p>
	</section>

	<!-- From I to We — the VISION beat, not the pricing page. A first-time
	     reader has never heard the word avenCOOP; explaining reinvest splits
	     and syndicate lists here answered a question nobody had yet. The
	     mechanics live on /pricing, where someone is actually asking. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="collective-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">
				Von Ich zu Wir · Die Bewegung
			</p>
			<h2
				id="collective-heading"
				class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
			>
				1 Million Gründer bauen die Startups der Zukunft — und besitzen sie gemeinsam.
			</h2>
			<p
				class="mx-auto mt-5 max-w-xl text-[1.125rem] font-light leading-snug text-pretty text-foreground sm:text-[1.3125rem]"
			>
				Ein Spark trägt ein Leben. Eine Million Sparks tragen eine Zivilisation.
			</p>

			<div
				class="mx-auto mt-8 max-w-2xl space-y-4 text-[15px] leading-relaxed text-foreground/68 sm:text-base"
			>
				<p class="text-pretty">
					Stell dir vor, was passiert, wenn eine Million Menschen aufhören, ihre Zeit zu verkaufen,
					und anfangen zu bauen, woran sie glauben — und einander daran beteiligen. Jeder mit seiner
					eigenen Firma. Keiner mehr Angestellter im Leben eines Konzerns.
				</p>
				<p class="text-pretty">
					Das ist die Welt, an die wir glauben:
					<strong class="font-medium text-foreground/88"
						>Solarpunk‑Utopie statt Cyberpunk‑Dystopie</strong
					>. Sie entsteht nicht dadurch, dass die Technologie besser wird — sondern nur, wenn die
					neuen Werkzeuge jedem Einzelnen wirklich gehören.
				</p>
				<p class="text-pretty">
					Keine Plattform, die dazwischen steht und Miete nimmt.
					<strong class="font-medium text-foreground/85"
						>Uns gehört, was wir gemeinsam bauen.</strong
					>
				</p>
			</div>

			<p class="mt-8">
				<a
					href="/pricing#avencoop"
					class="inline-flex min-h-11 items-center justify-center rounded-full border border-primary/45 px-8 text-[13px] font-semibold text-foreground transition-colors hover:bg-surface-soft"
				>
					Wie wir mitbauen: avenCOOP →
				</a>
			</p>
		</div>
	</section>

	<!-- Skills preview: what an Aven can already do, straight from the marketplace. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="skills-preview-heading"
	>
		<div class="mx-auto max-w-5xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent">Aven Skills</p>
				<h2
					id="skills-preview-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Fertige Skills für deinen Aven.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					Dein Aven lernt per Skill — installieren statt entwickeln. Ein Auszug:
				</p>
			</div>

			<div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each skillsPreview as skill (skill.slug)}
					<SkillMarketplaceCard {skill} />
				{/each}
			</div>

			<p class="mt-8 text-center">
				<a
					href="/skills"
					class="inline-flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-foreground/60 transition-colors hover:text-foreground"
				>
					Alle Skills ansehen →
				</a>
			</p>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div class="pb-6 text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent">
					Starte jetzt · First come, first serve
				</p>
				<h2
					class="mt-3 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					So fängt dein souveränes Gründerleben an.
				</h2>
				<p class="mx-auto mt-3 max-w-lg text-[15px] leading-snug text-foreground/68 sm:text-base">
					avenCEO startet invite‑only: Die Warteliste wird der Reihe nach freigeschaltet —
					<strong class="font-medium text-foreground/85">wer zuerst steht, gründet zuerst</strong>.
					Und dein Name ist dein erstes Asset: Jeden gibt es nur einmal.
				</p>
			</div>
			<AvenIdCheckCta variant="banner" />
		</div>
	</section>

	<footer
		class="border-t border-border/40 px-5 py-10 sm:px-8 text-center text-[11px] text-foreground/30"
	>
		avenCEO · avenOS · Own your life
	</footer>
</div>
