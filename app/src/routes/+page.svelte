<script lang="ts">
/**
 * The landing selector. The world used to mount straight here; now it lives at
 * /game and this page picks between it and the (placeholder) /dashboard.
 */
const views = [
	{ href: '/game', title: 'avenCITY', blurb: 'Enter the world.' },
	{ href: '/dashboard', title: 'Dashboard', blurb: 'Coming soon.' }
]
</script>

<main class="min-h-dvh flex flex-col items-center justify-center gap-10 p-8">
	<h1 class="avenos-wordmark"><span class="wm-aven">aven</span><span class="wm-os">OS</span></h1>

	<nav class="grid w-full max-w-2xl gap-4 sm:grid-cols-2">
		{#each views as view (view.href)}
			<a
				href={view.href}
				class="flex flex-col gap-2 rounded-2xl border border-border bg-surface-card p-6 text-left transition-colors hover:bg-surface-card-hover"
			>
				<span class="font-display text-2xl">{view.title}</span>
				<span class="text-sm opacity-60">{view.blurb}</span>
			</a>
		{/each}
	</nav>
</main>
