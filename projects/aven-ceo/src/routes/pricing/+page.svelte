<svelte:head>
	<title>Preise · aven.ceo · AvenCEO</title>
	<meta
		name="description"
		content="Pricing: Open Source · bezahlte Pläne — Einführungspreis (Founder 3 Mo. · Startup 6 Mo. · Enterprise 12 Mo.), danach regulär. Alle zzgl. USt."
	>
</svelte:head>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
		<div class="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-3 sm:justify-between sm:px-8">
			<a
				href="/"
				class="font-mono text-[11px] font-bold tracking-[0.14em] opacity-80 hover:opacity-100"
			>
				aven.ceo
			</a>
			<nav
				class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70"
			>
				<a href="/" class="transition-opacity hover:opacity-100">Start</a>
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

	<main class="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
		<h1 class="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
			Pricing</h1>
		<p class="mt-4 max-w-3xl text-[15px] leading-relaxed text-foreground/70">
			Preise sind <strong class="font-medium text-foreground/85">zzgl. USt.</strong> Bei den bezahlten Plänen gilt je Stufe eine
			<strong class="font-medium text-foreground/85">günstigere Einführungsphase</strong> (Founder <strong class="font-medium text-foreground/85">3</strong>&nbsp;Monate,
			Startup <strong class="font-medium text-foreground/85">6</strong>&nbsp;Monate, Company/Enterprise <strong class="font-medium text-foreground/85">12</strong>&nbsp;Monate)
			zum niedrigeren <strong class="font-medium text-foreground/85">€/Monat</strong>-Satz, anschließend der reguläre
			<strong class="font-medium text-foreground/85">€/Monat</strong>-Satz — jeweils
			<strong class="font-medium text-foreground/85">monatlich abgerechnet</strong>, ohne Jahreszahlung oder Jahresbindung.
			Jeder bezahlte Plan: jederzeit kündbar, wo vertraglich vorgesehen · AI‑Credits: du zahlst nur den Mehrverbrauch über die
			Paket‑Inklusivemenge, falls abrechenbar (Details Checkout).</p>

		<div class="mt-14 space-y-16">
			<section class="rounded-2xl border border-border/40 bg-white/40 p-6 ring-1 ring-black/5 sm:p-8">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/45">Plan 1 · Open Source</p>
						<h2 class="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Open Source Stack</h2>
						<p class="mt-1 text-lg font-semibold tabular-nums text-foreground">0&nbsp;€</p>
					</div>
					<ul class="max-w-md list-inside list-disc space-y-1.5 text-[14px] leading-relaxed text-foreground/72">
						<li>Self‑hosted Sync Service</li>
						<li>BYO API keys</li>
						<li>No backup (bring your own if needed)</li>
						<li>Community forum support</li>
					</ul>
				</div>
			</section>

			<section class="rounded-2xl border border-border/45 bg-tuscan-sun/50 p-6 ring-1 ring-black/[0.06] sm:p-8">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/50">Plan 2 · Founder CEO</p>
						<h2 class="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Founder CEO</h2>
					</div>
					<div class="w-full space-y-1 sm:min-w-56 sm:shrink-0">
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">Erste 3 Monate</p>
							<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">Danach</p>
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
								89&nbsp;€<span class="text-lg font-semibold text-foreground/62 sm:text-xl">/m</span></p>
							<p class="text-right text-base font-semibold tabular-nums tracking-tight text-foreground/55">
								144&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span></p>
						</div>
					</div>
				</div>
				<ul class="mt-6 grid gap-2 text-[14px] text-foreground/75 sm:grid-cols-2">
					<li>• 100 AI credits incl.</li>
					<li>• 2 Workspaces <span class="whitespace-nowrap">(Private &amp; Work)</span></li>
					<li>• 25 skills</li>
					<li>• unlimited import connectors</li>
					<li>• social media export connectors</li>
					<li>• 100&nbsp;GB storage</li>
					<li>• incl. weekly snapshots</li>
					<li>• “Aven only” Support</li>
				</ul>
			</section>

			<section class="rounded-2xl border border-border/40 bg-white/50 p-6 ring-1 ring-black/5 sm:p-8">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/50">Plan 3 · Startup CEO</p>
						<h2 class="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Startup CEO</h2>
					</div>
					<div class="w-full space-y-1 sm:min-w-56 sm:shrink-0">
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">Erste 6 Monate</p>
							<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">Danach</p>
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
								610&nbsp;€<span class="text-lg font-semibold text-foreground/62 sm:text-xl">/m</span></p>
							<p class="text-right text-base font-semibold tabular-nums tracking-tight text-foreground/55">
								987&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span></p>
						</div>
					</div>
				</div>
				<ul class="mt-6 grid gap-2 text-[14px] text-foreground/75 sm:grid-cols-2">
					<li>• 2.000 AI credits incl.</li>
					<li>• 5 workspaces</li>
					<li>• unlimited skills</li>
					<li>• unlimited import connectors</li>
					<li>• 10 export connectors</li>
					<li>• 4&nbsp;TB storage</li>
					<li>• incl. daily snapshots</li>
					<li class="font-medium text-foreground/85">• 1&nbsp;h / week Human Skill Trainer included</li>
				</ul>
			</section>

			<section class="rounded-2xl border border-border/45 bg-white/55 p-6 ring-1 ring-black/5 sm:p-8">
				<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/50">Plan 4 · Company CEO</p>
						<h2 class="mt-2 text-xl font-semibold text-foreground sm:text-2xl">Company CEO</h2>
						<p class="mt-1 text-sm text-foreground/55">Enterprise‑Umfang</p>
					</div>
					<div class="w-full space-y-1 sm:min-w-56 sm:shrink-0">
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">Erste 12 Monate</p>
							<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-foreground/45">Danach</p>
						</div>
						<div class="flex items-baseline justify-between gap-3">
							<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground sm:text-3xl">
								6.875&nbsp;€<span class="text-lg font-semibold text-foreground/62 sm:text-xl">/m</span></p>
							<p class="text-right text-base font-semibold tabular-nums tracking-tight text-foreground/55">
								10.950&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span></p>
						</div>
					</div>
				</div>
				<ul class="mt-6 grid gap-2 text-[14px] text-foreground/75 sm:grid-cols-2">
					<li>• 25.000 AI credits incl.</li>
					<li>• 100 workspaces</li>
					<li>• unlimited skills</li>
					<li>• unlimited import connectors</li>
					<li>• unlimited export connectors</li>
					<li>• 12&nbsp;TB storage + monthly LTO</li>
					<li>• incl. hourly snapshots</li>
					<li class="font-medium text-foreground/85">• 10&nbsp;h / week Human Skill Trainer included</li>
				</ul>
			</section>
		</div>

		<section
			class="mx-auto mt-14 max-w-2xl rounded-lg border border-border/30 bg-white/25 px-4 py-3.5 ring-1 ring-black/[0.04] sm:px-5"
		>
			<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/38">
				Optional · Human Skill Trainer
			</p>
			<p class="mt-1.5 text-[11px] leading-snug text-foreground/52">
				Wenn du beim Skill‑Aufbau Hilfe brauchst, begleitet dich ein Trainer kurz oder tief —
				jeder Use&nbsp;Case, nach Bedarf auf Stundenbasis.
			</p>
			<p class="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-foreground/48">
				<span>Founder <strong class="font-semibold text-foreground/62">+300&nbsp;€/h</strong></span>
				<span class="text-foreground/35">·</span>
				<span>Startup <strong class="font-semibold text-foreground/62">+250&nbsp;€/h</strong></span>
				<span class="text-foreground/35">·</span>
				<span>Enterprise <strong class="font-semibold text-foreground/62">+200&nbsp;€/h</strong></span>
			</p>
		</section>

		<p class="mt-14 text-center text-[13px] text-foreground/55">
			<a href="/" class="underline underline-offset-4 hover:text-foreground/80">← Zurück zur Übersicht</a>
		</p>
	</main>

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
