<svelte:head>
	<title>aven.ceo — CEO-Agent für dein Unternehmen</title>
	<meta
		name="description"
		content="aven.ceo: Aven ist der CEO-Agent deines Unternehmens. +10 h/m mehr Zeit, 95% weniger Papierkram."
	>
</svelte:head>

<div lang="de" class="min-h-screen bg-background text-foreground">
	<header
		class="min-h-dvh flex flex-col items-center justify-center px-6 sm:px-10 border-b border-border/50"
	>
		<div class="w-full max-w-2xl mx-auto text-center flex flex-col items-center gap-10 sm:gap-12">
			<p class="text-[10px] sm:text-xs font-bold font-mono tracking-[0.12em] opacity-35 lowercase">
				aven.ceo
			</p>

			<div class="space-y-6 sm:space-y-8">
				<p
					class="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-balance leading-snug"
				>
					<strong>Aven</strong> ist der <strong>CEO-Agent</strong> deines Unternehmens.
				</p>
				<p class="text-lg sm:text-xl md:text-2xl text-balance leading-relaxed opacity-80 font-medium">
					<strong class="text-foreground/95">+10h/m mehr Zeit</strong>
					<span class="opacity-50 mx-1">-</span>
					<strong class="text-foreground/95">95&nbsp;% weniger Papierkram</strong>.
				</p>
			</div>

			<a
				href="/me"
				class="inline-flex items-center justify-center rounded-full bg-foreground px-8 py-3.5 text-base font-semibold text-background hover:opacity-90 transition-opacity"
			>
				Zum Workspace
			</a>
		</div>
	</header>

	<section
		class="border-b border-border/50 px-6 sm:px-10 py-12 sm:py-14"
		aria-label="Grundprinzipien"
	>
		<div
			class="mx-auto max-w-5xl grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8 lg:gap-12"
		>
			<div class="text-center sm:text-left space-y-2.5">
				<h3 class="text-base sm:text-[1.0625rem] font-semibold tracking-tight text-balance leading-snug">
					Privat zwischen dir &amp; Aven
				</h3>
				<p class="text-xs sm:text-sm leading-relaxed text-pretty opacity-70 max-w-sm mx-auto sm:mx-0">
					100&nbsp;% <strong class="font-medium text-foreground/85">E2E-verschlüsselt</strong> — vom
					Gerät bis zum Sync. Kein Klartext auf
					<strong class="font-medium text-foreground/85">fremden Servern</strong>, die wir nicht
					kontrollieren.
				</p>
			</div>
			<div class="text-center sm:text-left space-y-2.5">
				<h3 class="text-base sm:text-[1.0625rem] font-semibold tracking-tight text-balance leading-snug">
					Local-first. Open Source.
				</h3>
				<p class="text-xs sm:text-sm leading-relaxed text-pretty opacity-70 max-w-sm mx-auto sm:mx-0">
					Zeitnah offline nutzbar, <strong class="font-medium text-foreground/85">Backup unter deiner
						Kontrolle</strong> — und Code, den du prüfen kannst. Transparenz statt Blackbox.
				</p>
			</div>
			<div class="text-center sm:text-left space-y-2.5">
				<h3 class="text-base sm:text-[1.0625rem] font-semibold tracking-tight text-balance leading-snug">
					Deine Daten. Null Lock-in.
				</h3>
				<p class="text-xs sm:text-sm leading-relaxed text-pretty opacity-70 max-w-sm mx-auto sm:mx-0">
					<strong class="font-medium text-foreground/85">Exportierbar</strong>, wenn du willst —
					<strong class="font-medium text-foreground/85">you own your data</strong>. Kein Vendor-Gefängnis,
					kein „wir horten alles“.
				</p>
			</div>
		</div>
	</section>

	<main class="mx-auto max-w-2xl px-6 py-16 sm:py-20 sm:px-8 space-y-12">
		<section>
			<h2 class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.35em] opacity-35 mb-3">
				Skill 1
			</h2>
			<p class="text-lg sm:text-xl font-semibold tracking-tight mb-3 text-balance">
				Bürokratie &amp; Dokumente
			</p>
			<p class="text-sm sm:text-base leading-relaxed opacity-80 text-pretty">
				Alles einspeisen (Abschlüsse, Rechnungen, Verträge …), auslesen, durchspielen —
				<strong class="font-medium text-foreground/90">eine klare Aktionsliste</strong>; Aven meldet
				sich, wenn <strong class="font-medium text-foreground/90">dein Okay</strong> nötig ist.
			</p>
		</section>

		<section class="opacity-90">
			<h2 class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.35em] opacity-35 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
				<span>Skill 2</span>
				<span
					class="font-mono text-[9px] sm:text-[10px] tracking-[0.12em] opacity-50 normal-case"
				>Demnächst</span>
			</h2>
			<p class="text-lg sm:text-xl font-semibold tracking-tight mb-3 text-balance">
				Aven&nbsp;E-Mail
			</p>
			<p class="text-sm sm:text-base leading-relaxed opacity-80 text-pretty">
				Dein Posteingang, aber endlich ruhig. Aven
				<strong class="font-medium text-foreground/90">sortiert, fasst zusammen und skizziert Antworten</strong>
				— Prioritäten sind klar, Noise verschwindet. Du freigibst, was rausgeht; der Rest läuft im
				Hintergrund.
			</p>
		</section>

		<section class="opacity-90">
			<h2 class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.35em] opacity-35 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1">
				<span>Skill 3</span>
				<span
					class="font-mono text-[9px] sm:text-[10px] tracking-[0.12em] opacity-50 normal-case"
				>Demnächst</span>
			</h2>
			<p class="text-lg sm:text-xl font-semibold tracking-tight mb-3 text-balance">
				Meetings &amp; Commitments
			</p>
			<p class="text-sm sm:text-base leading-relaxed opacity-80 text-pretty">
				Aus Gesprächen werden
				<strong class="font-medium text-foreground/90">Entscheidungen und To-dos</strong>, die nicht in
				Notizen versickern. Aven
				<strong class="font-medium text-foreground/90">hält Fristen fest</strong>, erinnert an Follow-ups
				und spiegelt Status — ohne zweites Projekttool.
			</p>
		</section>

		<section class="rounded-2xl border border-border/80 bg-white/25 px-6 py-7 sm:px-8 sm:py-8">
			<h2 class="text-[10px] sm:text-xs font-bold uppercase tracking-[0.35em] opacity-35 mb-3">
				Workspace
			</h2>
			<p class="text-sm sm:text-base leading-relaxed opacity-80">
				Intent-Posteingang für das, was noch von dir braucht — ohne Ordner graben.
			</p>
			<a
				href="/me"
				class="inline-block mt-5 text-sm font-semibold underline underline-offset-4 opacity-90 hover:opacity-100"
			>
				Öffnen →
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
