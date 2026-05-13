<script lang="ts">
import { type VibeAppId, vibeAppList } from '@avenos/vibe-apps'
import MarketingSiteHeader from '$lib/components/MarketingSiteHeader.svelte'
import VibeSandboxFrame from '$lib/vibe-apps/VibeSandboxFrame.svelte'

let selectedId = $state<VibeAppId>('invoice')
</script>

<svelte:head>
	<title>Vibe View Library — Aven Docs</title>
</svelte:head>

<div class="flex min-h-dvh flex-col bg-background text-foreground font-sans antialiased">
	<MarketingSiteHeader active="docs" />

	<div class="flex min-h-0 min-w-0 flex-1">
		<aside
			class="flex w-64 shrink-0 flex-col border-r border-border p-4"
			aria-label="Vibe View Library"
		>
			<p class="tech-label px-1 pb-2">Vibe View Library</p>
			<div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				{#each vibeAppList as app}
					<button
						type="button"
						onclick={() => {
							selectedId = app.id
						}}
						class="min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors {selectedId === app.id
							? 'border-[color:var(--color-tuscan-sun)] bg-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]'
							: 'border-border bg-white/10 hover:bg-white/20'}"
					>
						<span class="block truncate text-sm font-medium tracking-tight">{app.label}</span>
						<span
							class="mt-0.5 block min-w-0 truncate text-xs text-muted-foreground"
							title={app.description}
							>{app.description}</span
						>
					</button>
				{/each}
			</div>
			<!-- Back link pinned to bottom -->
			<a
				href="/docs"
				class="mt-auto shrink-0 flex items-center gap-2 rounded-lg px-2 py-1.5 pt-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground opacity-50 transition-opacity hover:opacity-100"
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
				Docs
			</a>
		</aside>

		<section class="flex min-h-0 min-w-0 flex-1 flex-col bg-sandbox-host p-6">
			<div class="flex min-h-0 min-w-0 flex-1 flex-col">
				{#key selectedId}
					<VibeSandboxFrame appId={selectedId} />
				{/key}
			</div>
		</section>
	</div>
</div>
