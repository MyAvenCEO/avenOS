<svelte:head>
	<title>aven.ceo — Agentischer CEO für den Papierkram</title>
	<meta
		name="description"
		content="aven.ceo: ein agentischer CEO, der lästigen Papierkram übernimmt. Use Case 1 — Dokumente digitalisieren; die erste Worker-Skill, mehr folgt."
	>
</svelte:head>

<div lang="de" class="min-h-screen bg-background text-foreground">
	<!-- Volle Viewport-Höhe: Pitch + große Typo -->
	<header class="min-h-dvh flex flex-col border-b border-border/50">
		<div class="shrink-0 w-full px-5 sm:px-8 pt-6 sm:pt-10">
			<p
				class="text-center text-base sm:text-lg md:text-xl font-medium tracking-tight text-balance max-w-3xl mx-auto leading-snug"
			>
				<strong class="font-semibold">Aven</strong>
				ist dein <span class="font-semibold">agentischer CEO</span> für Formulare, PDFs und
				Nachfasserei — du bleibst der echte CEO mit dem letzten Wort.
			</p>
		</div>

		<div
			class="flex-1 flex flex-col items-center justify-center px-6 sm:px-10 pb-16 sm:pb-24 pt-10 sm:pt-14"
		>
			<div class="w-full max-w-4xl mx-auto text-center flex flex-col items-center gap-8 sm:gap-10">
				<p
					class="text-[10px] sm:text-xs font-bold font-mono tracking-[0.12em] opacity-35 lowercase"
				>
					aven.ceo
				</p>

				<h1
					class="text-4xl sm:text-6xl md:text-7xl lg:text-8xl font-semibold tracking-tighter leading-[0.95] text-balance max-w-4xl"
				>
					Papierkram erledigt.<br class="hidden sm:block">
					<span class="opacity-85">Du entscheidest.</span>
				</h1>

				<p
					class="text-lg sm:text-xl md:text-2xl font-normal tracking-tight text-balance max-w-2xl mx-auto leading-relaxed opacity-75"
				>
					Während du Strategie und Risiko führst, arbeitet Aven die Bürokratie ab — strukturiert,
					erklärbar, in deinem Auftrag.
				</p>

				<a
					href="/me"
					class="mt-2 inline-flex items-center justify-center rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background hover:opacity-90 transition-opacity"
				>
					Zum Workspace
				</a>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-2xl px-6 py-16 sm:py-20 sm:px-8 space-y-14 sm:space-y-16">
		<section>
			<h2 class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.35em] opacity-35 mb-3">
				Use Case 1
			</h2>
			<p class="text-xl sm:text-2xl font-semibold tracking-tight leading-snug mb-3 text-balance">
				Dokumente digitalisieren &amp; auslesen
			</p>
			<p class="leading-relaxed opacity-80 text-pretty">
				Das ist die <strong class="font-medium text-foreground/95">erste Worker-Skill</strong> auf
				<span class="font-mono text-sm opacity-90">aven.ceo</span>
				— nicht das Endprodukt. Weitere Use Cases und Fähigkeiten kommen; hier starten wir mit dem
				Fundament: Material erfassen, Felder extrahieren, Metadaten zuordnen.
			</p>
		</section>

		<section class="rounded-2xl border border-border/80 bg-white/25 px-6 py-7 sm:px-8 sm:py-8">
			<h2 class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.35em] opacity-35 mb-4">
				Was du siehst
			</h2>
			<p class="text-lg font-medium tracking-tight mb-3">
				Ein klarer Aufgaben‑Posteingang — kein Ordner‑Chaos.
			</p>
			<p class="text-sm sm:text-base leading-relaxed opacity-80">
				Unterschreiben, verlängern, Abgleich — sortiert und begründet. Aven bereitet vor; du
				bestätigst.
			</p>
			<a
				href="/me"
				class="inline-block mt-6 text-sm font-semibold underline underline-offset-4 opacity-90 hover:opacity-100"
			>
				Intent‑Liste öffnen →
			</a>
		</section>
	</main>

	<footer class="mx-auto max-w-2xl px-6 pb-14 sm:px-8 text-xs opacity-35 text-center">
		Aven Maia
	</footer>
</div>

<style>
:global(body) {
	background-color: #e8ede1;
}
</style>
