<script lang="ts">
import UiLabPanel from '$lib/aven-ui/UiLabPanel.svelte'
</script>

<svelte:head>
	<title>Vibe-View Library — @AvenOS/app</title>
</svelte:head>

<div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background font-sans text-foreground antialiased">
	<div class="flex min-h-0 min-w-0 flex-1 flex-col px-4 py-6 sm:px-6">
		<header class="mb-4 flex shrink-0 items-baseline justify-between gap-3">
			<div>
				<p class="tech-label pb-1">Vibe-View Library</p>
				<p class="max-w-prose text-xs leading-snug text-muted-foreground">
					Alle aven-ui-Ansichten live — gerendert aus JSON View/Style/State, QuickJS-Logik in
					Tauri. Tabs zeigen die zugrunde liegenden Konfigurationen.
				</p>
			</div>
			<a
				href="/docs"
				class="flex shrink-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold tracking-widest text-muted-foreground uppercase opacity-50 transition-opacity hover:opacity-100"
			>
				<svg
					class="size-3 shrink-0"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					aria-hidden="true"
				>
					<path d="M19 12H5M11 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
				Dokumentation
			</a>
		</header>

		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			<UiLabPanel />
		</div>
	</div>
</div>
