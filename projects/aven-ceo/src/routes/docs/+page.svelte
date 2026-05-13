<script lang="ts">
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
</script>

<svelte:head>
	<title>Dokumentation — Aven CEO</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="docs" />

	<main class="flex-1 px-6 py-10 sm:px-10 sm:py-14">
		<div class="mx-auto max-w-5xl">
			<header class="mb-10">
				<p class="tech-label mb-3">Dokumentation</p>
				<h1 class="text-2xl font-semibold tracking-tight sm:text-3xl">AvenOS</h1>
				<p class="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
					<strong class="font-medium text-foreground">AvenOS</strong> ist das Betriebssystem unter
					deinem AvenCEO — mit Ende-zu-Ende-Verschlüsselung, Daten die dir gehören und einem KI,
					der mit dir wächst. Hier findest du, wie die einzelnen Teile zusammenspielen.
				</p>
			</header>

			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<a
					href="/docs/vibe-apps"
					class="tech-card group flex flex-col gap-3 p-5 no-underline transition-all hover:bg-white/20"
				>
					<div
						class="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-white/20 text-foreground/60 transition-colors group-hover:border-[color:var(--color-tuscan-sun)]/50 group-hover:text-foreground"
					>
						<svg
							class="size-4"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							aria-hidden="true"
						>
							<rect x="3" y="3" width="7" height="7" rx="1.5" />
							<rect x="14" y="3" width="7" height="7" rx="1.5" />
							<rect x="3" y="14" width="7" height="7" rx="1.5" />
							<rect x="14" y="14" width="7" height="7" rx="1.5" />
						</svg>
					</div>
					<div>
						<p class="text-sm font-semibold tracking-tight text-foreground">Vibe-View Library</p>
						<p class="mt-0.5 text-xs text-muted-foreground leading-snug">
							Alle Ansichten live im Browser — so sehen deine Daten in AvenCEO aus.
						</p>
					</div>
					<span
						class="mt-auto flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100"
					>
						Öffnen
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
					</span>
				</a>
			</div>
		</div>
	</main>
</div>
