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
import danielPhoto from '../images/daniel.png'
import samuelPhoto from '../images/samuel.jpg'

/** Beam “seed” string — hero beam geometry matches Samuel’s early‑alpha profile. */
const beamSeedSamuelProfile = 'Samuel Andert'

const paletteHuman = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')
const paletteKi = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader />

	<section
		class="border-b border-border/35 bg-linear-to-b from-white/35 via-background to-background px-5 py-24 sm:px-8 sm:py-32 md:py-40"
		aria-labelledby="home-hero-heading"
	>
		<div class="mx-auto max-w-3xl text-center">
			<h1
				id="home-hero-heading"
				class="mx-auto max-w-3xl font-sans text-3xl font-semibold leading-tight tracking-tight text-pretty text-foreground sm:text-4xl md:text-[3rem] md:leading-[1.08]"
			>
				Der traditionelle Job stirbt.
				<span class="mt-1 block">Nur wer Assets kreiert, überlebt.</span>
			</h1>
			<div
				class="mx-auto mt-10 max-w-xl border-t border-border/40 pt-8 text-[15px] leading-relaxed text-muted-foreground sm:max-w-2xl sm:text-base"
			>
				<p class="text-pretty text-[16px] font-medium text-foreground/85 sm:text-[17px]">
					Die Zukunft gehört dem
					<strong class="font-semibold text-foreground">souveränen Gründer</strong>, der mit seinem
					avenCEO Agenten
					<strong class="font-semibold text-foreground">5+ Assets</strong>
					aufbaut, statt
					<strong class="font-semibold text-foreground">1x Zeit gegen Geld</strong>
					zu tauschen.
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
					JETZT ist der perfekte Moment, der Creator deines vollen Lebenspotenzials zu sein.
				</h2>
				<p class="mx-auto mt-4 max-w-xl text-[15px] leading-snug text-foreground/68 sm:text-base">
					<strong class="font-medium text-foreground/85">Post‑AGI</strong>
					heißt einfach: KI erledigt fast jede Arbeit so gut wie ein Mensch —
					<strong class="font-medium text-foreground/85"
						>Kopfarbeit heute, mit Robotern bald auch Handarbeit</strong
					>
					— rund um die Uhr. Ab dann gibt es nur zwei Drehbücher für dein Leben:
				</p>
			</div>

			<!-- The emotional fork: the same future, seen from both sides. -->
			<div class="mt-10 grid gap-4 sm:grid-cols-2">
				<div class="rounded-2xl bg-[#222e49] p-6 ring-1 ring-black/20 sm:p-7">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-white/40">
						Ohne Assets
					</p>
					<h3 class="mt-2 text-lg font-semibold tracking-tight text-white sm:text-xl">
						Das fremdbestimmte Drehbuch
					</h3>
					<ul class="mt-4 space-y-2.5 text-[14px] leading-snug text-white/72">
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/25"
								aria-hidden="true"
							></span>
							<span>Deine Arbeitszeit konkurriert mit dem Preis von Strom.</span>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/25"
								aria-hidden="true"
							></span>
							<span
								>Jedes Gehalt ist ersetzbar — auch deins, auch wenn du es noch nicht spürst.</span
							>
						</li>
						<li class="flex gap-2.5">
							<span
								class="mt-1.5 size-1.5 shrink-0 rounded-full bg-white/25"
								aria-hidden="true"
							></span>
							<span
								>Deine Daten, deine Aufmerksamkeit, dein Alltag gehören den Plattformen anderer.</span
							>
						</li>
					</ul>
					<p
						class="mt-5 border-t border-white/10 pt-4 font-serif text-[1.25rem] font-light leading-snug text-white sm:text-[1.4rem]"
					>
						Dein Leben läuft nach dem Plan von jemand anderem.
					</p>
				</div>

				<div class="rounded-2xl bg-tuscan-sun/55 p-6 ring-1 ring-black/6 sm:p-7">
					<p class="font-mono text-[9px] font-bold uppercase tracking-[0.24em] text-foreground/45">
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
								>Ein Portfolio aus 5+ Assets: Produkte, Einkommensströme, deine Daten, deine KI,
								dein Name.</span
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
						class="mt-5 border-t border-foreground/10 pt-4 font-serif text-[1.25rem] font-light leading-snug text-foreground sm:text-[1.4rem]"
					>
						Dein volles Potenzial, in deiner Hand.
					</p>
				</div>
			</div>

			<p
				class="mx-auto mt-10 max-w-xl text-center font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
			>
				Beide Drehbücher beginnen heute. Wähle deins,
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
					<strong class="font-medium text-foreground/88">Spark</strong>
					— dein erster ist dein Leben selbst.
				</p>
			</div>
			<p
				class="mx-auto mt-9 max-w-xl border-t border-border/40 pt-7 font-serif text-[1.125rem] font-light leading-snug tracking-tight text-foreground sm:text-[1.3125rem]"
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
