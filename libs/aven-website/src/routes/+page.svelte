<svelte:head>
	<title>aven.ceo — In dir steckt so viel mehr · avenCEO</title>
	<meta
		name="description"
		content="Tief in deinem Herzen weißt du es: in dir steckt so viel mehr. Von Zeit gegen Geld zu: uns gehört, was wir gemeinsam bauen. Dein eigener avenCEO betreibt deine Firma — 1 Mensch + 1 Aven = ein Spark. Und viele Sparks tragen eine Zivilisation."
	>
</svelte:head>

<script lang="ts">
import { beamAvatarSvg, paletteFromCommaString } from '$lib/beam-avatar'
import AvenIdCheckCta from '$lib/components/AvenIdCheckCta.svelte'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import SkillMarketplaceCard from '$lib/components/SkillMarketplaceCard.svelte'
import { plan, priceLabel, VAT_NOTE } from '$lib/pricing/plans'
import { loadSkills } from '$lib/skills/loader'
import danielPhoto from '../images/daniel.png'
import samuelPhoto from '../images/samuel.jpg'

/** Beam “seed” string — hero beam geometry matches Samuel’s early‑alpha profile. */
const beamSeedSamuelProfile = 'Samuel Andert'

const paletteHuman = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')
/** A taste of the marketplace: the first six skills, the full list lives at /skills. */
const skillsPreview = loadSkills('de').slice(0, 6)

const paletteKi = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')

/**
 * The ladder builds ONE spark; every finished spark is one asset. Four steps
 * now, not six: the name, your life, your company, and the partnership — the
 * same four things the pricing page sells, in the same order and at the same
 * prices. It reads from `plans.ts` so a price can never drift between the two
 * pages again.
 */
const roadmap = [
	{
		id: 'avenid',
		offer: 'Deine Vision bekommt einen Namen',
		pitch:
			'Die Entscheidung in dein souveränes Gründerleben und deinen Aven ist der Anfang von allem.'
	},
	{
		id: 'avenme',
		offer: 'Bring dein eigenes Leben in Ordnung',
		pitch:
			'Post, E‑Mail, Dokumente, Termine: dein Aven übernimmt die tägliche Organisation — der Boden, auf dem alles andere steht.'
	},
	{
		id: 'avenceo',
		offer: 'Verkaufe dein erstes Angebot',
		pitch:
			'Deine erste eigene Spark‑Firma mit eigenem Produkt: Website, Shop, Blog, Vorbuchhaltung und Finanzen laufen — du lernst verkaufen und dienen.'
	},
	{
		id: 'avencoop',
		offer: 'Skaliere mit einem Co‑Founder an deiner Seite',
		pitch:
			'Wir bauen aktiv mit, führen dich durch die Gründung und dein beel‑Syndikat — Community‑Investments inklusive. Nur auf Bewerbung.'
	}
] as const
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
			<p
				class="mx-auto mt-6 max-w-2xl text-pretty text-[17px] font-medium leading-snug text-foreground/85 sm:text-[19px]"
			>
				Wir sind hier, um dir in den Hintern zu treten — und dich in dein bestes Selbst zu schieben.
			</p>
			<div
				class="mx-auto mt-10 max-w-xl border-t border-border/40 pt-8 text-[15px] leading-relaxed sm:max-w-2xl sm:text-base"
			>
				<p class="text-pretty text-[16px] font-medium text-foreground/85 sm:text-[17px]">
					Der Deal deines bisherigen Lebens hieß:
					<strong class="font-semibold text-foreground">Zeit gegen Geld</strong>.
				</p>
				<p class="mt-3 text-pretty text-[16px] font-medium text-foreground/85 sm:text-[17px]">
					Der neue heißt:
					<strong class="font-semibold text-accent-ink"
						>uns gehört, was wir gemeinsam bauen</strong
					>.
				</p>
			</div>
		</div>
	</section>

	<!-- Personal first: the transformation the reader can feel THIS week. The
	     civilizational arc only earns attention after the day-sized promise. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="personal-heading"
	>
		<div class="mx-auto max-w-2xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent-ink">
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

			<p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Mit deinem Aven fängt es klein an, und es fängt sofort an: Die Post ist sortiert, bevor du
				aufstehst. Die Rechnung ist vorbereitet, bevor du sie suchst. Der Papierkram, der dich seit
				Monaten anschweigt, ist erledigt, während du an dem arbeitest, wofür du eigentlich
				angetreten bist.
			</p>

			<p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Und dann passiert das Eigentliche:
				<strong class="font-medium text-foreground/85">was du baust, bleibt deins</strong>. Nicht
				deine Stunde ist das Asset. Du bist es.
			</p>

			<p class="mt-8 text-[16px] font-medium text-foreground/90 sm:text-[17px]">
				<strong class="font-semibold text-foreground"
					>Wir schieben dich in dein volles Potenzial — Schritt für Schritt, ab dieser Woche.</strong
				>
			</p>
		</div>
	</section>

	<!-- Vision: the grand arc — survival mode to abundance, solarpunk over cyberpunk. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="vision-heading"
	>
		<div class="mx-auto max-w-2xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-foreground/45">
				Vision · Von dir zu uns allen
			</p>
			<p
				id="vision-heading"
				class="mt-6 text-[1.35rem] font-light leading-snug text-pretty text-foreground sm:text-[1.6rem]"
			>
				Und was bei dir anfängt, hört bei dir nicht auf.
			</p>
			<p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Du spürst es: Die Welt verändert sich schneller als in jedem Moment der Geschichte — und
				genau deshalb ist jetzt die beste Zeit, am Leben zu sein.
			</p>
			<p class="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-foreground/68 sm:text-base">
				Wir können unsere Zivilisation endlich vom Überlebensmodus in die Fülle führen —
				<strong class="font-medium text-foreground/85"
					>Solarpunk‑Utopie statt Cyberpunk‑Dystopie</strong
				>
				— jedoch nur, wenn die neuen Werkzeuge jedem Einzelnen wirklich gehören.
			</p>
			<p class="mt-5 text-[16px] font-medium text-foreground/90 sm:text-[17px]">
				<strong class="font-semibold text-foreground"
					>Ownership — statt Zeit gegen Geld — ist die einzige Lösung.</strong
				>
			</p>
		</div>
	</section>

	<!-- The shift: the FOMO that is simply true — post-AGI touches everyone. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="shift-heading"
	>
		<div class="mx-auto max-w-4xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent-ink">
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
							<span
								>Dein avenCEO arbeitet rund um die Uhr — für dich, nicht für einen Konzern.</span
							>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/30"
								aria-hidden="true"
							></span>
							<span
								>Ein Portfolio aus 10+ Assets: Firmen, geboren aus deinen Visionen und betrieben von
								deinem Aven — plus Beteiligungen an denen anderer Gründer.</span
							>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-foreground/30"
								aria-hidden="true"
							></span>
							<span>Du gestaltest — Vision, Beziehungen, das Leben, das wirklich zählt.</span>
						</li>
					</ul>
					<p
						class="mt-5 border-t border-foreground/10 pt-4 text-[1.25rem] font-light leading-snug text-foreground sm:text-[1.4rem]"
					>
						Dein volles Potenzial, in deiner Hand.
					</p>
				</div>
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
			</div>

			<p
				class="mx-auto mt-10 max-w-xl text-center text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				Beide Drehbücher beginnen heute — und du schreibst eines davon sowieso.
				<strong class="font-sans font-semibold text-accent-ink">Nimm den Stift in die Hand.</strong>
			</p>
		</div>
	</section>

	<!-- The thesis: the company of the future, named. -->
	<section
		class="border-b border-border/40 bg-linear-to-b from-surface-soft/70 to-transparent px-5 py-16 sm:px-8 sm:py-24"
		aria-labelledby="spark-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-foreground/45">
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

	<!-- From I to We: one spark is a life, many sparks are a civilization. This
	     is where avenCOOP stops being a price tier and becomes the collective. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="collective-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-accent-ink">
				Von Ich zu Wir · avenCOOP
			</p>
			<h2
				id="collective-heading"
				class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
			>
				Ein Spark trägt ein Leben. Viele Sparks tragen eine Zivilisation.
			</h2>

			<div
				class="mx-auto mt-6 max-w-2xl space-y-4 text-[15px] leading-relaxed text-foreground/68 sm:text-base"
			>
				<p class="text-pretty">
					Allein bist du ein Funke. Verbunden seid ihr ein Feuer: Sparks, die sich gegenseitig
					beauftragen, beliefern und beteiligen — jeder mit seiner eigenen Firma, alle an den Firmen
					der anderen beteiligt.
				</p>
				<p class="text-pretty">
					Genau da steigen wir mit
					<strong class="font-medium text-foreground/88">avenCOOP</strong>
					selbst ein: als dein technischer Co‑Founder. Wir bauen mit, wir halten Anteile an deiner
					Firma — und du hältst welche an unserer. Über
					<strong class="font-medium text-foreground/88">beel</strong>
					führen wir dein Syndikat, und deine Community investiert mit.
				</p>
				<p class="text-pretty">
					Keine Plattform, die zwischen euch steht und Miete nimmt.
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
					avenCOOP ansehen →
				</a>
			</p>
		</div>
	</section>

	<section
		class="border-b border-border/40 bg-linear-to-b from-surface-soft/50 to-transparent px-5 py-9 sm:px-8 sm:py-11"
		id="founders"
	>
		<div class="mx-auto max-w-5xl">
			<header class="mx-auto max-w-2xl text-center">
				<p class="text-[9px] font-bold uppercase tracking-[0.26em] text-foreground/40">
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
							<p
								class="mt-0.5 text-[12px] font-bold tracking-[0.1em] text-accent-ink sm:text-[13px]"
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
						class="mt-4 border-t border-border/25 pt-3 text-center text-[10px] font-bold tracking-[0.2em] text-accent-ink sm:text-[11px]"
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
							<p
								class="mt-0.5 text-[12px] font-bold tracking-[0.1em] text-accent-ink sm:text-[13px]"
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
						class="mt-4 border-t border-border/25 pt-3 text-center text-[10px] font-bold tracking-[0.2em] text-accent-ink sm:text-[11px]"
					>
						= avenCEO Spark
					</p>
				</div>
			</div>
		</div>
	</section>

	<!-- Skills preview: what an Aven can already do, straight from the marketplace. -->
	<section
		class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-20"
		aria-labelledby="skills-preview-heading"
	>
		<div class="mx-auto max-w-5xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-foreground/45">
					Aven Skills
				</p>
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

	<!-- The ladder builds ONE spark; every repeat mints a new asset. -->
	<section
		class="border-b border-border/40 bg-gradient-to-b from-transparent via-surface-soft/70 to-transparent px-5 py-16 sm:px-8 sm:py-24"
		aria-labelledby="roadmap-heading"
	>
		<div class="mx-auto max-w-4xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.28em] text-foreground/45">
					Deine Roadmap · 0 → Hero
				</p>
				<h2
					id="roadmap-heading"
					class="mt-4 text-2xl font-semibold tracking-tight text-pretty text-foreground sm:text-3xl"
				>
					Vom Namen — über drei Stufen — zu 10+ Assets.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					Ein Name und drei Stufen bauen deinen ersten Spark — du levelst erst auf, wenn er
					<strong class="font-medium text-foreground/85"
						>mehr verdient, als die nächste Stufe kostet</strong
					>.
				</p>
				<p class="mt-3 text-[12px] text-foreground/45">{VAT_NOTE}</p>
			</div>

			<ol class="relative mt-14">
				<span
					class="absolute top-1 bottom-1 left-4 w-px -translate-x-1/2 bg-border/60 sm:left-1/2"
					aria-hidden="true"
				></span>
				{#each roadmap as level, i (level.id)}
					<li class="relative pb-12 pl-12 sm:pl-0">
						<span
							class="absolute top-0.5 left-4 flex size-7 -translate-x-1/2 items-center justify-center rounded-full text-[10px] font-bold sm:left-1/2 {i ===
							roadmap.length - 1
								? 'bg-primary text-primary-foreground'
								: 'bg-accent/60 text-foreground'}"
							aria-hidden="true"
						>
							{i + 1}
						</span>
						<div
							class="sm:w-[calc(50%-2.5rem)] {i % 2 === 0
								? 'sm:mr-auto sm:text-right'
								: 'sm:ml-auto'}"
						>
							<h3
								class="text-[17px] font-semibold tracking-tight text-pretty text-foreground sm:text-lg"
							>
								{level.offer}
							</h3>
							<p class="mt-1 text-[11px] tracking-[0.06em]">
								<span class="font-semibold text-foreground/70">{plan(level.id).name}</span>
								<span class="text-foreground/40">· {priceLabel(plan(level.id))}</span>
							</p>
							<p class="mt-2 text-[14px] leading-snug text-foreground/72 sm:text-[15px]">
								{level.pitch}
							</p>
						</div>
					</li>
				{/each}
			</ol>

			<!-- Repeat, centered below the ladder: reinvest into the other sparks. -->
			<div class="mt-6 text-center">
				<span
					class="mx-auto flex size-7 items-center justify-center rounded-full bg-accent text-[15px] text-foreground"
					aria-hidden="true"
				>
					↻
				</span>
				<div class="mt-3 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
					<span class="text-[13px] font-bold tracking-[0.06em] text-accent-ink"> Repeat </span>
					<span
						class="rounded-full bg-accent/25 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-accent-ink"
					>
						Jede Beteiligung = ein neues Asset
					</span>
				</div>
				<p class="mx-auto mt-2 max-w-md text-[14px] leading-snug text-foreground/72 sm:text-[15px]">
					Dein Spark trägt sich selbst — reinvestiere über
					<strong class="font-medium text-foreground/85">beel</strong>
					in die Sparks anderer Gründer. So wächst dein Portfolio auf
					<strong class="font-medium text-foreground/85">10+ Assets</strong>.
				</p>
			</div>
		</div>
	</section>

	<section class="border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-2xl">
			<div class="pb-6 text-center">
				<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
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
