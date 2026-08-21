<svelte:head>
	<title>Warteliste — avenID sichern · aven.ceo</title>
	<meta
		name="description"
		content="Sichere dir deine avenID und damit deinen Platz auf der Warteliste — der Weg in avenME, avenCEO und avenCOOP. Eingeladen wird der Reihe nach."
	>
</svelte:head>

<script lang="ts">
import { page } from '$app/stores'
import SiteFooter from '$lib/components/SiteFooter.svelte'
import { PLANS } from '$lib/pricing/plans'

const intent = $derived($page.url.searchParams.get('intent') ?? '')
const tier = $derived($page.url.searchParams.get('tier') ?? '')
const preferredFromUrl = $derived(
	$page.url.searchParams.get('preferred') ?? $page.url.searchParams.get('name') ?? ''
)

const TOTAL_STEPS = 4

let step = $state(1)
let email = $state('')
let name = $state('')
let preferredName = $state('')
let idea = $state('')
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
		.slice(0, 24)
)

const intentLabel = $derived.by(() => {
	switch (intent) {
		case 'aven-id':
			return 'AvenID / Namen sichern'
		case 'coop-application':
			return 'avenCOOP · Bewerbung'
		case 'ceo-plan':
			return tier ? `Plan · ${PLANS.find((p) => p.id === tier)?.name ?? tier}` : 'Plan buchen'
		case 'skill-tuning':
			return 'Skill‑Training / Coaching'
		default:
			return ''
	}
})

const introHeadline = $derived.by(() => {
	const n = preferredFromUrl
	if (n) return `Schön, ${n} — deinen eigenen avenCEO haben willst du also.`
	switch (intent) {
		case 'aven-id':
			return 'Schön, dass du deinen Aven‑Namen sichern willst.'
		case 'coop-application':
			return 'Schön, dass du dich für avenCOOP bewerben willst.'
		case 'ceo-plan':
			return 'Schön, dass du deinen eigenen avenCEO haben willst.'
		case 'skill-tuning':
			return 'Schön, dass du deine Skills trainieren lassen willst.'
		default:
			return 'Schön, dass du dabei sein willst.'
	}
})

/**
 * Why anyone is standing here, in their own words. Every tier is invite-only
 * and the avenID is the door to all of them: it is the name AND the position
 * in the queue, so reserving it is what turns "interessiert" into a place we
 * can actually invite. The text says that plainly, from wherever they came.
 */
const introBody = $derived.by(() => {
	const planName = PLANS.find((p) => p.id === tier)?.name ?? ''
	switch (intent) {
		case 'coop-application':
			return `avenCOOP vergeben wir nicht der Reihe nach, sondern nach Passung — wir steigen als technischer Co‑Founder bei dir ein, und das entscheiden wir gemeinsam. Der Weg dahin führt trotzdem über deine avenID: Sie reserviert deinen Namen, hält deinen Platz auf der Warteliste und zeigt uns, dass es dir ernst ist. Deine Bewerbung lesen wir danach persönlich.`
		case 'ceo-plan':
			return `${planName || 'Dein Plan'} startet invite‑only — buchen kannst du erst, wenn du eingeladen bist. Deinen Platz sicherst du dir jetzt über deine avenID: Der Name gehört dir, und die Reihenfolge der Warteliste ist die Reihenfolge der Einladungen. Sobald du dran bist, schalten wir ${planName || 'deinen Plan'} für dich frei.`
		case 'aven-id':
			return `Deine avenID ist zweierlei auf einmal: der Name, unter dem dein Aven erreichbar ist — und dein Platz in der Warteliste. Eingeladen wird der Reihe nach, und jeden Namen gibt es genau einmal.`
		default:
			return `Deine avenID ist der Anfang von allem: der Name, unter dem dein Aven erreichbar ist, und zugleich dein Platz auf der Warteliste. Eingeladen wird der Reihe nach.`
	}
})

const emailOk = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))

function nextFromStep1() {
	error = ''
	step = 2
}

function nextFromStep2() {
	error = ''
	if (!emailOk) {
		error = 'Bitte gib eine gültige E‑Mail ein.'
		return
	}
	step = 3
}

function nextFromStep3() {
	error = ''
	step = 4
}

async function finish() {
	error = ''
	if (honeypot) return
	if (!emailOk) {
		error = 'Bitte prüfe deine E‑Mail.'
		step = 2
		return
	}
	busy = true
	try {
		const res = await fetch('/api/waitlist', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: email.trim(),
				name: name.trim(),
				preferredName: preferredSlug,
				idea: idea.trim(),
				intent,
				tier,
				website: honeypot
			})
		})
		const data = await res.json().catch(() => ({}))
		if (!res.ok || !data?.ok) {
			error =
				data?.error === 'email_invalid'
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

/** The tier they came in on, named — so the note back to us is unambiguous. */
const tierPlan = $derived(PLANS.find((p) => p.id === tier) ?? null)
</script>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/88 backdrop-blur-md">
		<div
			class="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-5 sm:justify-between sm:px-8"
		>
			<a href="/" class="flex items-center gap-2.5">
				<img src="/aven-logo.svg" alt="" class="size-7 shrink-0" width="28" height="28">
				<span class="text-[17px] font-semibold tracking-tight text-foreground">avenCEO</span>
			</a>
			<nav
				class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-70"
			>
				<a href="/skills" class="transition-opacity hover:opacity-100">Skills</a>
				<a href="/pricing" class="transition-opacity hover:opacity-100">Preise</a>
				<a
					href="/waitlist"
					class="rounded-full bg-primary px-4 py-1.5 normal-case font-semibold text-primary-foreground transition-opacity hover:opacity-90"
				>
					Sichere dir deinen Aven
				</a>
			</nav>
		</div>
	</header>

	<section class="border-b border-border/40 px-5 py-10 sm:px-8 sm:py-12">
		<div class="mx-auto max-w-lg">
			<div>
				{#if intentLabel}
					<p class="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">
						{intentLabel}
					</p>
				{/if}
				<h1 class="mt-2 text-xl text-foreground sm:text-2xl">
					{introHeadline}
				</h1>
				<p class="mt-3 text-[14px] leading-relaxed text-foreground/68">{introBody}</p>
				<p class="mt-3 text-[14px] leading-relaxed text-foreground/68">
					Wir sind noch in der Early Alpha — avenMAIA und avenTIN laufen gerade auf uns selbst:
					echte Posteingänge, echte Dokumente, echter Alltag. Wir schleifen, bis wir sagen können:
					<em class="not-italic font-medium text-foreground/80"
						>das gibt dir nachweislich Zeit zurück.</em
					>
					Dann geht es los — und du bist als Erster dabei.
				</p>
				<p class="mt-2 text-[13px] leading-snug text-foreground/50">
					Vier kurze Schritte · wir melden uns, sobald du dran bist.
				</p>
			</div>

			{#if done}
				<div
					class="mt-8 rounded-2xl border border-accent/40 bg-accent/15 px-5 py-8 text-center ring-1 ring-accent/25 sm:px-8"
				>
					<p class="text-[10px] font-bold uppercase tracking-[0.22em] text-accent-ink">Danke</p>
					<p class="mt-3 text-[16px] font-semibold text-foreground">Du bist auf der Liste.</p>
					<p class="mt-2 text-[14px] leading-relaxed text-foreground/68">
						Dein Platz ist notiert. Wir melden uns per Mail, sobald du dran bist — und sonst nicht.
					</p>
					<p class="mt-6">
						<a
							href="/"
							class="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/55 hover:text-foreground/85"
						>
							Zur Startseite →
						</a>
					</p>
				</div>
			{:else}
				<!-- Progress -->
				<div class="mx-auto mt-8 flex max-w-xs items-center gap-1.5 sm:max-w-sm" aria-hidden="true">
					{#each Array(TOTAL_STEPS) as _, i (i)}
						<div
							class="h-1 flex-1 rounded-full transition-colors {i + 1 < step ? 'bg-accent/75' : i + 1 === step ? 'bg-accent' : 'bg-foreground/12'}"
						></div>
					{/each}
				</div>
				<p
					class="mt-2 text-center text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/38"
				>
					Schritt {step} von {TOTAL_STEPS}
				</p>

				<form
					class="relative mt-6"
					aria-label="Warteliste — mehrstufig"
					onsubmit={(e) => e.preventDefault()}
				>
					<label class="absolute -left-[9999px] top-0 opacity-0" aria-hidden="true">
						Website
						<input
							bind:value={honeypot}
							type="text"
							name="website"
							tabindex="-1"
							autocomplete="off"
						>
					</label>

					<!-- Step 1: Aven-Name -->
					{#if step === 1}
						<p class="text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">
							Schritt 1 · Aven‑Name
						</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">
							Vor‑Reservierung deines einmaligen Aven‑Namens.
						</p>
						<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-stretch">
							<label
								class="flex min-h-12 flex-1 cursor-text items-center gap-1 rounded-full border border-border/60 bg-surface-raised px-4 focus-within:border-accent/50"
							>
								<input
									bind:value={preferredName}
									type="text"
									name="preferredName"
									autocomplete="off"
									spellcheck="false"
									placeholder="maia"
									onkeydown={(e) => onStepKeydown(e, 1)}
									class="min-w-0 flex-1 bg-transparent py-3 text-[15px] font-medium tracking-tight text-foreground outline-none placeholder:text-foreground/35"
								>
								<span
									class="shrink-0 text-[13px] {preferredSlug ? 'text-foreground/55' : 'text-foreground/28'}"
									>.aven.ceo</span
								>
							</label>
							<button
								type="button"
								onclick={nextFromStep1}
								class="inline-flex min-h-12 shrink-0 items-center justify-center rounded-full bg-primary px-6 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:px-7"
							>
								Reservieren
							</button>
						</div>
						{#if preferredSlug}
							<p class="mt-2 text-[12px] text-foreground/55">
								<strong class="font-semibold text-foreground/72">{preferredSlug}.aven.ceo</strong>
								<span class="text-foreground/35"> · </span>mail@{preferredSlug}.aven.ceo
							</p>
						{/if}
						<p class="mt-2 text-[11px] leading-snug text-foreground/42">
							Keine Live‑Verfügbarkeits‑Garantie: wir bieten dir deinen Wunschnamen zuerst an —
							Kauf/Option erst mit späterer Bestätigung.
						</p>
						<div class="mt-4 flex justify-center">
							<a
								href="/"
								class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline"
								>Zurück</a
							>
						</div>
					{/if}

					<!-- Step 2: E-Mail -->
					{#if step === 2}
						<p class="text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">
							Schritt 2 · E‑Mail
						</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">
							Deine E‑Mail für Beta‑Einladung und Rückfragen.
						</p>
						<div class="mt-4 flex min-w-0 items-center gap-2">
							<input
								bind:value={email}
								type="email"
								name="email"
								autocomplete="email"
								placeholder="du@mail.com"
								onkeydown={(e) => onStepKeydown(e, 2)}
								class="min-h-11 min-w-0 flex-1 rounded-xl border border-border/55 bg-surface-raised px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-foreground/38 focus:border-accent/50"
							>
							<button
								type="button"
								onclick={nextFromStep2}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
							>
								Weiter
							</button>
						</div>
						<div class="mt-3 flex justify-center">
							<button
								type="button"
								onclick={() => { step = 1; error = '' }}
								class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline"
							>
								Zurück
							</button>
						</div>
					{/if}

					<!-- Step 3: Ansprache -->
					{#if step === 3}
						<p class="text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">
							Schritt 3 · Ansprache
						</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">
							Wie dürfen wir dich nennen?
						</p>
						<div class="mt-4 flex min-w-0 items-center gap-2">
							<input
								bind:value={name}
								type="text"
								name="name"
								autocomplete="name"
								placeholder="z. B. Samuel"
								onkeydown={(e) => onStepKeydown(e, 3)}
								class="min-h-11 min-w-0 flex-1 rounded-xl border border-border/55 bg-surface-raised px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-foreground/28 focus:border-accent/50"
							>
							<button
								type="button"
								onclick={nextFromStep3}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
							>
								Weiter
							</button>
						</div>
						<div class="mt-3 flex justify-center">
							<button
								type="button"
								onclick={() => { step = 2; error = '' }}
								class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline"
							>
								Zurück
							</button>
						</div>
					{/if}

					<!-- Step 4: the idea. Optional — but this is the one we read when we
					     hand out a wildcard invite ahead of the queue. -->
					{#if step === 4}
						<p class="text-[9px] font-bold uppercase tracking-[0.22em] text-foreground/45">
							Schritt 4 · Deine Idee
						</p>
						<p class="mt-2 text-[14px] leading-snug text-foreground/78">
							{#if tierPlan}
								Du interessierst dich für
								<strong class="font-medium text-foreground">{tierPlan.name}</strong>. Was willst du
								damit bauen — und warum?
							{:else}
								Was willst du mit deinem Aven bauen — und warum?
							{/if}
						</p>
						<p class="mt-2 text-[13px] leading-snug text-foreground/55">
							Ein paar Sätze reichen. Wir vergeben
							<strong class="font-medium text-accent-ink">Wildcard‑Einladungen</strong>
							an die Ideen, die uns umhauen — unabhängig vom Platz in der Warteliste.
						</p>
						<textarea
							bind:value={idea}
							name="idea"
							rows="5"
							placeholder="Ich will …"
							class="mt-4 w-full rounded-xl border border-border/55 bg-surface-raised px-4 py-3 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-foreground/28 focus:border-accent/50"
						></textarea>
						<div class="mt-4 flex items-center justify-between gap-3">
							<button
								type="button"
								onclick={() => { step = 3; error = '' }}
								class="text-[12px] font-semibold text-foreground/40 underline-offset-4 hover:text-foreground/70 hover:underline"
							>
								Zurück
							</button>
							<button
								type="button"
								disabled={busy}
								onclick={() => finish()}
								class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-primary px-6 text-[13px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
							>
								{busy ? 'Senden …' : idea.trim() ? 'Platz sichern' : 'Ohne Idee absenden'}
							</button>
						</div>
					{/if}

					{#if error}
						<p class="mt-5 text-[13px] font-medium text-red-800/90">{error}</p>
					{/if}

					<p class="mt-6 text-center text-[10px] leading-snug text-foreground/42">
						Mit Abschluss erklärst du dich einverstanden, dass wir dich zur Beta kontaktieren.
						<span class="text-foreground/38">Keine Newsletter, kein Weiterverkauf.</span>
					</p>
				</form>
			{/if}
		</div>
	</section>

	<SiteFooter />
</div>
