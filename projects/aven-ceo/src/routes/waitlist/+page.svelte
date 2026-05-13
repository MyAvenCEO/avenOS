<svelte:head>
	<title>Warteliste — AvenCEO Beta &amp; Labor‑Updates · aven.ceo</title>
	<meta
		name="description"
		content="Trage dich für die AvenCEO Beta‑Warteliste ein: Aven‑Name, E‑Mail, Ansprache, optionale wöchentliche Labor‑Updates."
	>
</svelte:head>

<script lang="ts">
	import { page } from '$app/stores'

	const intent = $derived($page.url.searchParams.get('intent') ?? '')
	const tier = $derived($page.url.searchParams.get('tier') ?? '')
	const preferredFromUrl = $derived(
		$page.url.searchParams.get('preferred') ?? $page.url.searchParams.get('name') ?? '',
	)

	const TOTAL_STEPS = 4

	let step = $state(1)
	let email = $state('')
	let name = $state('')
	let preferredName = $state('')
	let newsletter = $state(true)
	let honeypot = $state('')
	let busy = $state(false)
	let done = $state(false)
	let error = $state('')

	$effect(() => {
		if (preferredFromUrl) preferredName = preferredFromUrl
	})

	const preferredSlug = $derived(
		preferredName
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, '')
			.replace(/^-+|-+$/g, '')
			.slice(0, 24),
	)

	const intentLabel = $derived.by(() => {
		switch (intent) {
			case 'aven-id': return 'AvenID / Namen sichern'
			case 'ceo-plan':
				return tier
					? `CEO‑Plan · ${tier === 'founder' ? 'Founder' : tier === 'startup' ? 'Startup' : tier === 'investor' ? 'Investor' : tier}`
					: 'CEO‑Plan buchen'
			case 'skill-tuning': return 'Skill‑Training / Coaching'
			default: return ''
		}
	})

	const introHeadline = $derived.by(() => {
		const n = preferredFromUrl
		if (n) return `Schön, ${n} — deinen eigenen AvenCEO haben willst du also.`
		switch (intent) {
			case 'aven-id': return 'Schön, dass du deinen Aven‑Namen sichern willst.'
			case 'ceo-plan': return 'Schön, dass du deinen eigenen AvenCEO haben willst.'
			case 'skill-tuning': return 'Schön, dass du deine Skills trainieren lassen willst.'
			default: return 'Schön, dass du dabei sein willst.'
		}
	})

	const emailOk = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

	function nextFromStep1() { error = ''; step = 2 }

	function nextFromStep2() {
		error = ''
		if (!emailOk) { error = 'Bitte gib eine gültige E‑Mail ein.'; return }
		step = 3
	}

	function nextFromStep3() { error = ''; step = 4 }

	async function finish(newsletterChoice: boolean) {
		error = ''
		if (honeypot) return
		if (!emailOk) { error = 'Bitte prüfe deine E‑Mail.'; step = 2; return }
		newsletter = newsletterChoice
		busy = true
		try {
			const res = await fetch('/api/waitlist', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: email.trim(),
					name: name.trim(),
					preferredName: preferredSlug,
					newsletter,
					intent,
					tier,
					website: honeypot,
				}),
			})
			const data = await res.json().catch(() => ({}))
			if (!res.ok || !data?.ok) {
				error = data?.error === 'email_invalid'
					? 'Bitte prüfe deine E‑Mail-Adresse.'
					: 'Das hat nicht geklappt. Versuche es später noch einmal.'
				return
			}
			done = true
		} catch {
			error = 'Netzwerkfehler. Bitte später erneut versuchen.'
		} finally {
			busy = false
		}
	}

	function onStepKeydown(e: KeyboardEvent, stage: 1 | 2 | 3) {
		if (e.key !== 'Enter') return
		e.preventDefault()
		if (stage === 1) nextFromStep1()
		if (stage === 2) nextFromStep2()
		if (stage === 3) nextFromStep3()
	}
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/88 backdrop-blur-md">
		<div class="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8">
			<a href="/" class="font-serif text-[17px] font-light tracking-[-0.01em] opacity-85 hover:opacity-100">
				AvenCEO
			</a>
			<nav class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70">
				<a href="/skills" class="transition-opacity hover:opacity-100">Skills</a>
				<a href="/pricing" class="transition-opacity hover:opacity-100">Preise</a>
				<a href="/me" class="rounded-full border border-border/80 bg-white/15 px-3 py-1 opacity-95 hover:opacity-100 transition-opacity">
					Login
				</a>
			</nav>
		</div>
	</header>

	<section class="border-b border-border/40 px-5 py-10 sm:px-8 sm:py-12">
		<div class="mx-auto max-w-lg">
			<div>
				{#if intentLabel}
					<p class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-tuscan-sun">
						{intentLabel}
					</p>
				{/if}
				<h1 class="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
					{introHeadline}
				</h1>
				<p class="mt-3 text-[14px] leading-relaxed text-foreground/68">
					Wir sind noch in der Early Alpha — AvenMaia und AvenOS laufen gerade auf uns selbst:
					echte Posteingänge, echte Dokumente, echter Alltag.
					Wir schleifen, bis wir sagen können: <em class="not-italic font-medium text-foreground/80">das gibt dir nachweislich Zeit zurück.</em>
					Dann geht es los — und du bist als Erster dabei.
				</p>
				<p class="mt-2 text-[13px] leading-snug text-foreground/50">
					Vier kurze Schritte · wir melden uns zur Beta.<br />
					Optional: wöchentliche Labor‑Updates aus dem Bau.
				</p>
			</div>

			{#if done}
				<div class="mt-8 rounded-2xl border border-tuscan-sun/40 bg-tuscan-sun/15 px-5 py-8 text-center ring-1 ring-tuscan-sun/25 sm:px-8">
					<p class="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-tuscan-sun">Danke</p>
					<p class="mt-3 text-[16px] font-semibold text-foreground">Du bist auf der Liste.</p>
					<p class="mt-2 text-[14px] leading-relaxed text-foreground/68">
						Wir melden uns per Mail, sobald die Beta startet.
						{#if newsletter}
							Wöchentliche Labor‑Updates sind aktiv — Abmeldung mit einem Klick in jeder Ausgabe.
						{:else}
							Du erhältst nur Beta‑relevante Einladungen und Rückfragen, keine Labor‑Updates.
						{/if}
					</p>
					<p class="mt-6">
						<a href="/" class="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/55 hover:text-foreground/85">
							Zur Startseite →
						</a>
					</p>
				</div>
			{:else}
				<!-- Progress -->
				<div class="mx-auto mt-8 flex max-w-xs items-center gap-1.5 sm:max-w-sm" aria-hidden="true">
					{#each Array(TOTAL_STEPS) as _, i (i)}
						<div class="h-1 flex-1 rounded-full transition-colors {i + 1 < step ? 'bg-tuscan-sun/75' : i + 1 === step ? 'bg-tuscan-sun' : 'bg-foreground/12'}"></div>
					{/each}
				</div>
				<p class="mt-2 text-center font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/38">
					Schritt {step} von {TOTAL_STEPS}
				</p>

				<form class="relative mt-6" aria-label="Warteliste — mehrstufig" onsubmit={(e) => e.preventDefault()}>
					<label class="absolute -left-[9999px] top-0 opacity-0" aria-hidden="true">
						Website
						<input bind:value={honeypot} type="text" name="website" tabindex="-1" autocomplete="off" />
					</label>

					<!-- Step 1: Aven-Name -->
					{#if step === 1}
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">Schritt 1 · Aven‑Name</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">Vor‑Reservierung deines einmaligen Aven‑Namens.</p>
						<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
							<label class="flex min-h-12 flex-1 cursor-text items-center gap-1 rounded-full border border-border/60 bg-white/85 px-4 ring-1 ring-black/4 focus-within:border-tuscan-sun/50">
								<input
									bind:value={preferredName}
									type="text"
									name="preferredName"
									autocomplete="off"
									spellcheck="false"
									placeholder="dein-name"
									onkeydown={(e) => onStepKeydown(e, 1)}
									class="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-medium tracking-tight text-foreground outline-none placeholder:text-foreground/35"
								/>
								<span class="shrink-0 font-mono text-[13px] {preferredSlug ? 'text-foreground/55' : 'text-foreground/28'}">.aven.ceo</span>
							</label>
							<button
								type="button"
								onclick={nextFromStep1}
								class="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-foreground px-6 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 sm:px-7"
							>
								Reservieren
							</button>
						</div>
						{#if preferredSlug}
							<p class="mt-2 text-[12px] text-foreground/55">
								<strong class="font-semibold text-foreground/72">{preferredSlug}.aven.ceo</strong>
								<span class="text-foreground/35"> · </span>{preferredSlug}@aven.ceo
							</p>
						{/if}
						<p class="mt-2 text-[11px] leading-snug text-foreground/42">
							Keine Live‑Verfügbarkeits‑Garantie: wir bieten dir deinen Wunschnamen zuerst an — Kauf/Option erst mit späterer Bestätigung.
						</p>
						<div class="mt-4 flex justify-center">
							<a href="/" class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline">Zurück</a>
						</div>
					{/if}

					<!-- Step 2: E-Mail -->
					{#if step === 2}
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">Schritt 2 · E‑Mail</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">Deine E‑Mail für Beta‑Einladung und Rückfragen.</p>
						<div class="mt-4 flex min-w-0 items-center gap-2">
							<input
								bind:value={email}
								type="email"
								name="email"
								autocomplete="email"
								placeholder="du@mail.com"
								onkeydown={(e) => onStepKeydown(e, 2)}
								class="min-h-11 min-w-0 flex-1 rounded-xl border border-border/55 bg-white/90 px-4 py-3 text-[15px] text-foreground outline-none ring-1 ring-black/5 placeholder:text-foreground/38 focus:border-tuscan-sun/50"
							/>
							<button
								type="button"
								onclick={nextFromStep2}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
							>
								Weiter
							</button>
						</div>
						<div class="mt-3 flex justify-center">
							<button type="button" onclick={() => { step = 1; error = '' }} class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline">Zurück</button>
						</div>
					{/if}

					<!-- Step 3: Ansprache -->
					{#if step === 3}
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">Schritt 3 · Ansprache</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">Wie dürfen wir dich nennen?</p>
						<div class="mt-4 flex min-w-0 items-center gap-2">
							<input
								bind:value={name}
								type="text"
								name="name"
								autocomplete="name"
								placeholder="z. B. Samuel"
								onkeydown={(e) => onStepKeydown(e, 3)}
								class="min-h-11 min-w-0 flex-1 rounded-xl border border-border/55 bg-white/90 px-4 py-3 text-[15px] text-foreground outline-none ring-1 ring-black/5 placeholder:text-foreground/28 focus:border-tuscan-sun/50"
							/>
							<button
								type="button"
								onclick={nextFromStep3}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-foreground px-5 text-[13px] font-semibold text-background transition-opacity hover:opacity-90"
							>
								Weiter
							</button>
						</div>
						<div class="mt-3 flex justify-center">
							<button type="button" onclick={() => { step = 2; error = '' }} class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline">Zurück</button>
						</div>
					{/if}

					<!-- Step 4: Newsletter -->
					{#if step === 4}
						<p class="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">Schritt 4 · Labor‑Updates</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">
							<strong class="font-medium text-foreground/82">Wöchentliche Labor‑Updates</strong> zu Beta, Skills &amp; Dogfooding — oder nur das Nötigste per Mail?
						</p>
						<div class="mt-6 grid gap-3 sm:grid-cols-2">
							<button
								type="button"
								disabled={busy}
								onclick={() => finish(true)}
								class="inline-flex min-h-12 items-center justify-center rounded-full bg-foreground px-6 text-[13px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{busy ? 'Senden …' : 'Ja, wöchentliche Labor‑Updates'}
							</button>
							<button
								type="button"
								disabled={busy}
								onclick={() => finish(false)}
								class="inline-flex min-h-12 items-center justify-center rounded-full border border-border/60 bg-white/55 px-6 text-[13px] font-semibold text-foreground transition-colors hover:bg-white/85 disabled:opacity-50"
							>
								{busy ? 'Senden …' : 'Nein, nur Beta‑Infos'}
							</button>
						</div>
						<div class="mt-5 flex justify-center">
							<button type="button" onclick={() => { step = 3; error = '' }} class="text-[12px] font-semibold text-foreground/50 hover:text-foreground/75">
								Zurück
							</button>
						</div>
					{/if}

					{#if error}
						<p class="mt-5 text-[13px] font-medium text-red-800/90">{error}</p>
					{/if}

					<p class="mt-6 text-center text-[10px] leading-snug text-foreground/42">
						Mit Abschluss erklärst du dich einverstanden mit Kontakt zur Beta
						<span class="text-foreground/38"> — wöchentliche Labor‑Updates nur wenn du Ja wählst.</span>
					</p>
				</form>
			{/if}
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
