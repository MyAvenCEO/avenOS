<script lang="ts">
const entityPhrases = [
	'deine Firma',
	'dein Startup',
	'dein Gewerbe',
	'dein Einzelunternehmen'
] as const
let entityTick = $state(0)

$effect(() => {
	const id = setInterval(() => {
		entityTick += 1
	}, 2500)
	return () => clearInterval(id)
})

const entityPhrase = $derived(entityPhrases[entityTick % entityPhrases.length])
</script>

<svelte:head>
	<title>aven.ceo — AvenCEO managed deine Firma auf Autopilot</title>
	<meta
		name="description"
		content="AvenCEO orchestriert dein Geschäft. Du hast die Vision — AvenCEO plant, koordiniert und setzt um."
	>
</svelte:head>

<div lang="de" class="min-h-screen bg-background text-foreground font-sans antialiased">
	<header class="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-md">
		<div class="mx-auto flex max-w-3xl items-center justify-center gap-8 px-5 py-3 sm:px-8">
			<a
				href="/"
				class="font-mono text-[11px] font-bold tracking-[0.14em] opacity-80 hover:opacity-100"
			>
				aven.ceo
			</a>
			<nav
				class="flex items-center gap-5 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-55"
			>
				<a href="/board" class="opacity-90 hover:opacity-100 transition-opacity">Board</a>
				<a
					href="/me"
					class="rounded-full border border-border/80 bg-white/15 px-3 py-1 opacity-90 hover:opacity-100 transition-opacity"
				>
					Schreibtisch
				</a>
			</nav>
		</div>
	</header>

	<section
		class="border-b border-border/40 px-5 pt-12 pb-16 sm:px-8 sm:pt-16 sm:pb-20 md:pt-20 md:pb-24"
	>
		<div class="mx-auto max-w-3xl text-center">
			<p
				class="mb-5 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-foreground/40"
			>
				aven.ceo
			</p>
			<h1
				class="flex flex-col items-center gap-1.5 text-[1.6rem] leading-[1.15] font-semibold tracking-[-0.03em] text-pretty sm:gap-2 sm:text-4xl md:text-5xl md:leading-[1.1]"
			>
				<span>AvenCEO managed</span>
				<span
					class="inline-block w-fit max-w-full rounded-lg bg-tuscan-sun/55 px-2.5 py-1 text-foreground font-semibold shadow-sm ring-1 ring-black/6 transition-colors duration-300"
					aria-live="polite"
				>
					{entityPhrase}
				</span>
				<span>auf Autopilot</span>
			</h1>
			<p
				class="mx-auto mt-5 max-w-xl text-base text-foreground/70 sm:text-lg text-pretty leading-relaxed"
			>
				Du hast die <strong class="font-medium text-foreground/88">Vision</strong> —{' '}
				<strong class="font-medium text-foreground/88">Dein AvenCEO</strong>
				plant, koordiniert und setzt um.
			</p>
			<p
				class="mx-auto mt-3 max-w-xl text-base text-foreground/65 sm:text-lg text-pretty leading-relaxed"
			>
				Wenn es zählt, fragt er dich um Rat.
			</p>
			<div class="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
				<a
					href="/me"
					class="inline-flex h-11 items-center justify-center rounded-full bg-foreground px-7 text-sm font-semibold text-background hover:opacity-90 transition-opacity"
				>
					Zum Schreibtisch
				</a>
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
