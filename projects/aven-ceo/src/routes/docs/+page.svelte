<script lang="ts">
import { type VibeAppId, vibeAppList } from '@avenos/vibe-apps'
import VibeSandboxFrame from '$lib/vibe-apps/VibeSandboxFrame.svelte'

let selectedId = $state<VibeAppId>('todos')
</script>

<svelte:head>
	<title>Vibe apps — Aven CEO</title>
</svelte:head>

<div class="flex min-h-dvh bg-background text-foreground">
	<aside
		class="flex w-72 shrink-0 flex-col gap-1 border-r border-border p-4"
		aria-label="Vibe apps"
	>
		<p class="tech-label px-1 pb-2">Vibe apps</p>
		{#each vibeAppList as app}
			<button
				type="button"
				onclick={() => {
					selectedId = app.id
				}}
				class="rounded-xl border px-3 py-2.5 text-left transition-colors {selectedId === app.id
					? 'border-[color:var(--color-tuscan-sun)] bg-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]'
					: 'border-border bg-white/10 hover:bg-white/20'}"
			>
				<span class="block text-sm font-medium tracking-tight">{app.label}</span>
				<span class="mt-0.5 block text-xs text-muted-foreground">{app.description}</span>
			</button>
		{/each}
	</aside>

	<section class="flex min-h-0 min-w-0 flex-1 flex-col">
		<header class="shrink-0 px-6 pt-6 pb-4">
			<h1 class="text-lg font-semibold tracking-tight">Sandbox</h1>
			<p class="mt-1 max-w-prose text-sm text-muted-foreground">
				The artifact runs in a separate origin (<code class="rounded bg-muted px-1 py-px text-xs"
					>localhost:8081</code
				>).
			</p>
		</header>

		<div class="flex min-h-0 min-w-0 flex-1 flex-col">
			{#key selectedId}
				<VibeSandboxFrame appId={selectedId} />
			{/key}
		</div>
	</section>
</div>
