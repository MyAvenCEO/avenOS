<svelte:head>
	<title>aven.ceo — AvenCEO · dein privates zweites Gehirn für Gründer &amp; CEOs</title>
	<meta
		name="description"
		content="Lieber CEO und Gründer: 10+ Stunden mehr Zeit pro Woche — Ein AvenCEO verwandelt deine Arbeitsweise in selbstoptimierende KI‑Skills und arbeitet so einen Großteil deines zeitraubenden Alltags ab."
	>
</svelte:head>

<script lang="ts">
	import { beamAvatarSvg, paletteFromCommaString } from '$lib/intent-mock/beam-avatar'

	const paletteHuman = paletteFromCommaString('f7ead9,ccc7a8,88b499,305669,222e49')
	const paletteKi = paletteFromCommaString('e8c9a8,d4a574,c9a962,305669,222e49')

	/** Repo für Selbst-Hosting · Open‑Source‑Stack (URL bei Bedarf anpassen). */
	const openSourceGithubHref = 'https://github.com/jaensen/AvenOS'

	const avenIdPriceStandardEur = 55
	const avenIdPriceEarlyBirdEur = 8
	/** Rundung gegen Standardpreis Early Bird vs. Standard. */
	const avenIdDiscountVsStandardPct = Math.round(
		((avenIdPriceStandardEur - avenIdPriceEarlyBirdEur) / avenIdPriceStandardEur) * 100,
	)

	const stattStacks = [
		'Notion · Confluence · interne Wikis',
		'Webflow · Contentful · schwere WordPress-Stacks',
		'Zapier · Make · n8n Cloud',
		'HubSpot · Salesforce · Pipedrive',
		'Asana · Monday · Linear · ClickUp',
		'sevDesk · Lexoffice · Odoo / SAP B1 Cloud'
	] as const

	/** Kalendertag in Europe/Berlin — für den Brieftext „heute“. */
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
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8">
			<a
				href="/"
				class="font-mono text-[11px] font-bold tracking-[0.14em] opacity-80 hover:opacity-100"
			>
				aven.ceo
			</a>
			<nav
				class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70"
			>
				<a href="/#pricing" class="transition-opacity hover:opacity-100">Preise</a>
				<a
					href="/me"
					class="rounded-full border border-border/80 bg-white/15 px-3 py-1 opacity-95 hover:opacity-100 transition-opacity"
				>
					Login
				</a>
			</nav>
		</div>
	</header>

	<section class="border-b border-border/40 px-5 py-24 sm:px-8 sm:py-32 md:py-40">
		<div class="mx-auto max-w-3xl text-center">
			<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
				aven.ceo
			</p>
			<h1
				class="mt-4 text-[1.55rem] font-semibold tracking-[-0.03em] text-pretty leading-snug text-foreground sm:text-3xl md:text-[2.35rem] md:leading-[1.15]"
			>
				<span class="block text-lg font-normal text-foreground/80 sm:text-xl md:text-2xl"
					>Lieber CEO und Gründer,</span
				>
				<span class="mt-3 block">10+ Stunden mehr Zeit pro Woche</span>
				<span
					class="mt-2 block font-serif text-[clamp(1.25rem,3.85vw,2.05rem)] font-light leading-[1.08] tracking-tight text-foreground/92"
					>Für Vision, Produkt und das Leben, das wirklich zählt.</span
				>
			</h1>
			<div class="mx-auto mt-8 max-w-2xl space-y-5 text-[15px] leading-relaxed text-foreground/72 sm:text-base">
				<p>
					Ein AvenCEO verwandelt deine Arbeitsweise in
					<strong class="font-medium text-foreground/88">selbstoptimierende KI‑Skills</strong>
					und arbeitet so einen Großteil
					<strong class="font-medium text-foreground/85">deines zeitraubenden Unternehmer‑Alltags</strong>
					ab.</p>
			</div>
		</div>
	</section>

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
					Grund auf mit aufbaut.</p>
			</header>

			<!-- Zwei Tandems: Human + Aven nebeneinander, echte Trio-Zeile mit Plus -->
			<div class="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 sm:gap-4">
				<div class="rounded-2xl border border-border/35 bg-white/25 px-3 py-4 sm:px-4 sm:py-4">
					<div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-2 sm:gap-x-3">
						<div class="flex min-w-0 flex-col items-center justify-start text-center">
							<div
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg('Samuel Andert', paletteHuman, 64, 'fnd-h-s')}
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
								class="size-14 shrink-0 overflow-hidden rounded-full ring-2 ring-background sm:size-16 [&>svg]:block [&>svg]:size-full"
								aria-hidden="true"
							>
								{@html beamAvatarSvg('Daniel Janz', paletteHuman, 64, 'fnd-h-d')}
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
								{@html beamAvatarSvg('AvenOS', paletteKi, 64, 'fnd-k-o')}
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
							Beispiel‑Skills</p>
						<ul
							class="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 sm:grid-cols-3 md:grid-cols-3"
							aria-label="Beispiele für mögliche Skills"
						>
							{#each [
								{
									title: 'Posteingang & Triage',
									blurb: 'Triage · Entwürfe — du gibst frei.'
								},
								{
									title: 'Rechnungen & Belege',
									blurb: 'Zuordnung & Freigaben vorbereiten.'
								},
								{
									title: 'Kunden‑Onboarding',
									blurb: 'Checklisten & erste Schritte im Griff.'
								},
								{
									title: 'Investor‑Updates',
									blurb: 'Struktur, KPIs, Lücken schließen.'
								},
								{
									title: 'Verträge & Fristen',
									blurb: 'Laufzeiten, Versionen, Reminder.'
								},
								{
									title: 'Hiring & Termine',
									blurb: 'Slots koordinieren, Follow-ups nicht verlieren.'
								},
								{
									title: 'Meetings & Nachbereitung',
									blurb: 'Notizen → To-dos mit Owner & Deadline.'
								},
								{
									title: 'Board & KPIs',
									blurb: 'Zahlen bündeln, Abweichungen, Kurzbrief.'
								},
								{
									title: 'Produktfeedback',
									blurb: 'Support/Sales bündeln, priorisieren.'
								}
							] as skill (skill)}
								<li
									class="flex flex-col gap-0.5 rounded-lg border border-border/35 bg-white/45 px-2 py-1.5 text-left ring-1 ring-black/3 sm:px-2.5 sm:py-2"
								>
									<span class="text-[11px] font-semibold leading-tight text-foreground/88 sm:text-[12px]">{skill.title}</span>
									<span class="text-[10px] leading-snug text-foreground/58 sm:text-[11px]">{skill.blurb}</span>
								</li>
							{/each}
						</ul>
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

	<section id="pricing" class="scroll-mt-28 border-b border-border/40 px-5 py-14 sm:px-8 sm:py-16">
		<div class="mx-auto max-w-6xl">
			<div class="mx-auto max-w-2xl text-center">
				<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40">
					Pricing
				</p>
				<h2 class="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
					Wähle das Paket, das zu deiner aktuellen unternehmerischen Phase passt.</h2>
			</div>

			<div class="mt-12 flex flex-col gap-5 lg:flex-row lg:gap-6 lg:items-stretch">
				<aside
					class="flex min-w-0 flex-col rounded-2xl border border-border/40 bg-white/55 p-5 ring-1 ring-black/5 lg:w-[min(20rem,100%)] lg:max-w-none lg:shrink-0"
				>
					<div class="text-center">
						<p class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]">
							Aven CEO – ID</p>
					</div>
					<div class="mt-3 space-y-2">
						<div class="grid grid-cols-2 gap-x-3 gap-y-1">
							<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">Early&nbsp;Bird</p>
							<p class="text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">
								Standard</p>
							<div class="flex min-w-0 flex-nowrap items-center justify-start gap-x-2">
								<span class="shrink-0 text-2xl font-bold tabular-nums tracking-tight text-foreground"
									>{avenIdPriceEarlyBirdEur}&nbsp;€</span>
								<span
									class="inline-flex shrink-0 items-center rounded-full border border-border/45 bg-tuscan-sun/55 px-2 py-0.5 text-[13px] font-semibold tabular-nums leading-none tracking-tight text-foreground ring-1 ring-black/6 sm:text-sm"
									title={`Ersparnis gegenüber Standard (${avenIdPriceStandardEur}\u00a0€)`}
								>
									−{avenIdDiscountVsStandardPct}&nbsp;%</span>
							</div>
							<p class="text-right text-2xl font-bold tabular-nums tracking-tight text-foreground">
								{avenIdPriceStandardEur}&nbsp;€</p>
							<p
								class="col-span-2 mt-2 text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-tuscan-sun sm:text-[13px]"
							>
								Nur noch 10x Early&nbsp;Bird</p>
						</div>
					</div>
					<ul class="mt-4 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75">
						<li>
							<strong class="font-medium text-foreground/82">4&nbsp;Std</strong> AvenCEO Test‑Zugang</li>
						<li>Sichere dir deine AvenID</li>
						<li>
							z.&nbsp;B. <strong class="font-semibold text-foreground/82">AvenBob</strong>
							<span class="text-foreground/55">· bob.aven.ceo · bob@aven.ceo</span></li>
						<li>
							Exklusiver Social‑CEO‑Netzwerk‑Zugang</li>
						<li>
							Einfaches <strong class="font-medium text-foreground/82">One‑Click‑Self‑Hosting</strong> mit deiner Aven&nbsp;ID
							<span class="text-foreground/55">· BYO API‑Keys</span></li>
					</ul>
					<div class="mt-3 flex min-h-0 flex-1 flex-col justify-end gap-2">
						<div class="border-t border-foreground/8 pt-3 text-center">
							<p class="font-mono text-[8px] font-bold uppercase tracking-[0.22em] text-foreground/45">Bonus</p>
							<p class="mt-1 text-center text-[9px] leading-snug text-foreground/62 sm:text-[10px] sm:leading-[1.42]">
								<strong class="font-medium text-foreground/78">Dauerhafter Zugang</strong> zu Maia&nbsp;City — das
								<strong class="font-medium text-foreground/78">CEO‑Gründerspiel</strong>, in dem wir skizzieren, wie wir
								<strong class="font-medium text-foreground/82">menschliche Städte von morgen</strong>
								in den Arbeitsalltag einweben.
								Eine <strong class="font-medium text-foreground/82">Post‑AGI‑Wirtschaftssimulation</strong>: Gründerinnen und Gründer
								erproben kühnere und freundlichere Rhythmen von Wirtschaft, Fürsorge und
								<strong class="font-medium text-foreground/82">besseren Lebensweisen</strong>.</p>
						</div>
						<div class="flex justify-center">
							<a
								href="/me"
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 sm:text-[13px]"
							>
								AvenID sichern
							</a>
						</div>
					</div>
				</aside>

				<div class="grid min-w-0 flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
				<div
					class="flex min-w-0 flex-col rounded-2xl border border-border/45 bg-tuscan-sun/55 p-5 ring-1 ring-black/6"
				>
					<div class="text-center">
						<p class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]">
							Founder CEO</p>
					</div>
					<div class="mt-3 space-y-1">
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">Erste 3 Monate</p>
							<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Danach</p>
						</div>
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
								144&nbsp;€<span class="text-lg font-semibold text-foreground/62">/m</span></p>
							<p class="text-right text-base font-semibold tabular-nums tracking-tight text-foreground/55">
								233&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span></p>
						</div>
					</div>
					<ul class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75">
						<li>1 Aven ID</li>
						<li>
							KI inklusive: max. <strong class="font-medium text-foreground/82">1&nbsp;Std / Tag</strong>
							<span class="text-foreground/55">(~60&nbsp;Min.)</span>
						</li>
						<li>2 Workspaces Private + Work</li>
						<li>25 Skills</li>
						<li>Unbegrenzte Import‑Connectors</li>
						<li>Social‑Media‑Export‑Connectors</li>
						<li>100&nbsp;GB Storage</li>
						<li>Wöchentliche Snapshots</li>
						<li>AvenOS&nbsp;support</li>
					</ul>
					<div class="mt-6 flex justify-center border-t border-foreground/10 pt-4 lg:mt-auto">
						<a
							href="/me"
							class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
						>
							Buchen</a>
					</div>
				</div>

				<div
					class="flex min-w-0 flex-col rounded-2xl border border-border/40 bg-white/50 p-5 ring-1 ring-black/5"
				>
					<div class="text-center">
						<p class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]">
							Startup CEO</p>
					</div>
					<div class="mt-3 space-y-1">
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">Erste 6 Monate</p>
							<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Danach</p>
						</div>
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
								610&nbsp;€<span class="text-lg font-semibold text-foreground/62">/m</span></p>
							<p class="text-right text-base font-semibold tracking-tight text-foreground/55 tabular-nums">
								987&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span></p>
						</div>
					</div>
					<ul class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75">
						<li>1 Aven ID</li>
						<li>
							KI inklusive: max. <strong class="font-medium text-foreground/82">4&nbsp;Std / Tag</strong>
							<span class="text-foreground/55">(~240&nbsp;Min.)</span>
						</li>
						<li>5 Workspaces</li>
						<li>Unbegrenzte Skills</li>
						<li>Unbegrenzte Import‑Connectors</li>
						<li>10 Export‑Connectors</li>
						<li>4&nbsp;TB Storage</li>
						<li>Tägliche Snapshots</li>
						<li>Nie wieder Papier – Briefpost digital</li>
						<li class="font-medium text-foreground/82">Support durch AvenOS&nbsp;+ AvenMaia</li>
						<li class="font-medium text-foreground/82">+ 1&nbsp;Std/Woche Samuel &amp; Daniel</li>
					</ul>
					<div class="mt-6 flex justify-center border-t border-foreground/10 pt-4 lg:mt-auto">
						<a
							href="/me"
							class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
						>
							Buchen</a>
					</div>
				</div>

				<div
					class="flex min-w-0 flex-col rounded-2xl border border-border/45 bg-white/55 p-5 ring-1 ring-black/5 sm:col-span-2 lg:col-span-1"
				>
					<div class="text-center">
						<p class="mt-2 text-lg font-bold uppercase tracking-[0.14em] text-foreground sm:text-xl sm:tracking-[0.12em]">
							Enterprise CEO</p>
					</div>
					<div class="mt-3 space-y-1">
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground/45">Erste 12 Monate</p>
							<p class="text-[10px] font-semibold uppercase tracking-widest text-foreground/45">Danach</p>
						</div>
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-2xl font-bold tabular-nums tracking-tight text-foreground">
								6.875&nbsp;€<span class="text-lg font-semibold text-foreground/62">/m</span></p>
							<p class="text-right text-base font-semibold tracking-tight text-foreground/55 tabular-nums">
								10.950&nbsp;€<span class="text-sm font-semibold text-foreground/55">/m</span></p>
						</div>
					</div>
					<ul class="mt-4 flex-1 space-y-1.5 text-left text-[12px] leading-snug text-foreground/75">
						<li>1 Aven ID</li>
						<li>
							KI inklusive: bis zu <strong class="font-medium text-foreground/82">24&nbsp;Std / Tag</strong>
							<span class="text-foreground/55">(Fair‑Use)</span>
						</li>
						<li>100 Workspaces</li>
						<li>Unbegrenzte Skills</li>
						<li>Unbegrenzte Import‑ &amp; Export‑Connectors</li>
						<li>12&nbsp;TB + monatliches LTO</li>
						<li>Stündliche Snapshots</li>
						<li>Nie wieder Papier – Briefpost digital</li>
						<li class="font-medium text-foreground/82">Support durch AvenOS&nbsp;+ AvenMaia</li>
						<li class="font-medium text-foreground/82">+ 10&nbsp;Std/Woche Samuel &amp; Daniel</li>
					</ul>
					<div class="mt-6 flex justify-center border-t border-foreground/10 pt-4 lg:mt-auto">
						<a
							href="/me"
							class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
						>
							Buchen</a>
					</div>
				</div>
				</div>
			</div>

			<div
				class="mx-auto mt-12 max-w-4xl rounded-2xl border border-border/50 bg-linear-to-br from-white/55 via-white/38 to-transparent px-5 py-6 shadow-[0_12px_40px_-24px_rgb(0_0_0/0.35)] ring-1 ring-black/6 sm:mt-14 sm:px-8 sm:py-8"
			>
				<p
					class="text-center font-mono text-[10px] font-bold uppercase tracking-[0.28em] text-tuscan-sun sm:text-[11px]"
				>
					OPTIONAL · MEHR KI + COACH PER MINUTE</p>
				<p
					class="mx-auto mt-2 max-w-2xl text-center font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-foreground/45 sm:text-[10px]"
				>
					Extra KI‑Minuten&nbsp;· höchst persönlicher Skill‑Support durch Samuel&nbsp;&amp; Daniel</p>
				<div
					class="mt-6 flex flex-col gap-8 lg:mt-8 lg:flex-row lg:items-stretch lg:gap-0 lg:divide-x lg:divide-border/35"
				>
					<aside
						class="border-b border-border/35 pb-8 text-center lg:w-[min(17rem,38%)] lg:shrink-0 lg:border-b-0 lg:border-border/35 lg:pb-0 lg:pr-8 lg:text-left"
					>
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.28em] text-foreground/45">
							Zusätzliche KI‑Minuten</p>
						<p class="mx-auto mt-3 max-w-[16rem] text-[13px] leading-snug text-foreground/72 lg:mx-0">
							Jede zusätzliche <strong class="font-medium text-foreground/82">KI‑Minute</strong> über dein
							tagesbezogenes Kontingent.</p>
						<p class="mx-auto mt-4 text-2xl font-bold tabular-nums tracking-tight text-foreground lg:mx-0">10&nbsp;Cent/min</p>
						<p class="mx-auto mt-2 max-w-[16rem] font-mono text-[10px] font-medium leading-snug uppercase tracking-[0.08em] text-foreground/38 lg:mx-0">
							Kein Mindestvolumen · minutengleich abgerechnet</p>
					</aside>
					<div class="min-w-0 flex-1 lg:pl-8">
						<p
							class="mx-auto max-w-xl text-center text-[14px] font-medium leading-relaxed text-foreground/74 sm:text-[16px] sm:leading-snug lg:mx-0 lg:max-w-none lg:text-left"
						>
							Wenn du bei deinem Skill‑Tuning Hilfe brauchst, begleiten dich Samuel + Daniel höchst persönlich — jeder
							Use&nbsp;Case, nach Bedarf auf <strong class="font-semibold text-foreground/82">Minutenbasis</strong>.</p>
						<div
							class="mx-auto mt-6 grid max-w-sm grid-cols-1 gap-7 text-center sm:mt-8 sm:max-w-2xl sm:grid-cols-3 sm:gap-6 lg:mx-0"
						>
							<div class="flex flex-col items-center gap-1 lg:items-start lg:text-left">
								<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/50">Founder</p>
								<p class="text-lg font-semibold tabular-nums text-foreground sm:text-xl">3&nbsp;€/min</p>
								<p class="text-[11px] font-medium tabular-nums tracking-tight text-foreground/42 sm:text-[12px]">
									≈ 180&nbsp;€/h</p>
							</div>
							<div class="flex flex-col items-center gap-1 lg:items-start lg:text-left">
								<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/50">Startup</p>
								<p class="text-lg font-semibold tabular-nums text-foreground sm:text-xl">4&nbsp;€/min</p>
								<p class="text-[11px] font-medium tabular-nums tracking-tight text-foreground/42 sm:text-[12px]">
									≈ 240&nbsp;€/h</p>
							</div>
							<div class="flex flex-col items-center gap-1 lg:items-start lg:text-left">
								<p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/50">Enterprise</p>
								<p class="text-lg font-semibold tabular-nums text-foreground sm:text-xl">5&nbsp;€/min</p>
								<p class="text-[11px] font-medium tabular-nums tracking-tight text-foreground/42 sm:text-[12px]">
									≈ 300&nbsp;€/h</p>
							</div>
						</div>
					</div>
				</div>
				<div
					class="mx-auto mt-8 flex w-full max-w-none flex-col items-center gap-4 border-t border-border/35 pt-5 text-center"
				>
					<p class="max-w-xl text-[12px] font-medium leading-snug text-foreground/58 sm:text-[13px]">
						Du zahlst immer nur die Minuten, die du Samuel &amp; Daniel für Skill‑Tuning tatsächlich genutzt hast.</p>
					<a
						href="/me"
						class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border/60 bg-white/55 px-6 text-[12px] font-semibold text-foreground transition-colors hover:bg-white/85"
					>
						Request Skill Tuning</a>
				</div>
			</div>

			<div class="mx-auto mt-12 max-w-6xl rounded-2xl border border-border/40 bg-white/40 p-5 ring-1 ring-black/5 sm:p-7 lg:p-8">
				<div class="grid gap-10 lg:grid-cols-[minmax(13.5rem,17rem)_1fr] lg:gap-14 lg:items-start">
					<div class="shrink-0 border-b border-foreground/8 pb-8 lg:border-b-0 lg:border-r lg:border-foreground/8 lg:pb-0 lg:pr-10">
						<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/45">
							OPTIONAL · EIGENES HOSTING</p>
						<h3 class="mt-2 text-lg font-semibold text-foreground sm:text-xl">AvenOS</h3>
						<p class="mt-1 text-[11px] leading-snug text-foreground/55 sm:text-[12px]">Open‑Source‑Stack zum Selbsthosten</p>
						<p class="mt-1 text-lg font-semibold tabular-nums text-foreground">0&nbsp;€</p>
						<ul
							class="mt-5 space-y-2 border-t border-border/30 pt-5 text-[13px] leading-snug text-foreground/72"
							aria-label="AvenOS Übersicht"
						>
							<li class="flex gap-2"><span aria-hidden="true" class="text-foreground/40">·</span><span>Self‑hosted Sync‑Service</span></li>
							<li class="flex gap-2"><span aria-hidden="true" class="text-foreground/40">·</span><span>Bring Your Own API Keys</span></li>
							<li class="flex gap-2">
								<span aria-hidden="true" class="text-foreground/40">·</span>
								<span>Keine Backups<span class="text-foreground/55"> — optional selbst bereitstellbar</span></span>
							</li>
							<li class="flex gap-2"><span aria-hidden="true" class="text-foreground/40">·</span><span>Community‑Forum‑Support</span></li>
						</ul>
					</div>
					<div class="min-w-0 lg:max-w-none">
						<p class="max-w-none font-serif text-[1.0625rem] font-light italic leading-snug text-foreground/84 sm:text-[1.125rem] sm:leading-snug">
							Kein Produkt ohne Haltung&nbsp;— das ist kein Satz aus dem Handbuch. Deine Daten gehören dir. Deine Arbeitsintelligenz gehört dir.
							Ende‑zu‑Ende‑verschlüsselt, Schlüssel bei dir&nbsp;— wir haben keinen Hinterzugang, und wir wollen keinen. Das wäre kein Geschäftsmodell.
							Das wäre Verrat.</p>
						<p class="mt-5 max-w-none text-[14px] leading-[1.65] text-foreground/73 sm:text-[15px] sm:leading-[1.7]">
							Wir bauen keine Falle. Wenn du gehst, kommen deine Skills und deine gesamte aufgebaute Arbeitsintelligenz mit.
							Kein Pflichtgespräch, kein Labyrinth, das sich erst beim Kündigen zeigt. Wer dich festhält, wenn du frei sein willst,
							war nie wirklich auf deiner Seite.</p>
						<p class="mt-5 max-w-none text-[14px] font-medium leading-[1.6] text-foreground/78 sm:text-[15px] sm:leading-[1.68]">
							<strong class="font-semibold text-foreground/85">Self‑Hosting über AvenOS</strong> ist für alle,
							die ihre eigene Infra lieben&nbsp;— und für alle, die einfach wissen wollen, dass die Tür offen ist.</p>
					</div>
				</div>
				<div class="mt-8 flex justify-center border-t border-foreground/10 pt-6">
					<a
						href={openSourceGithubHref}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-foreground px-8 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
					>
						AvenOS auf GitHub</a>
				</div>
			</div>
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
