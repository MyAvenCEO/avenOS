<script lang="ts">
/**
 * Dashboard — placeholder. Greets, says what it will become, and links back to
 * the selector. Swap `name` for the real identity once one exists again.
 */
const name = 'Samuel'
</script>

<svelte:head>
	<title>Dashboard · avenOS</title>
</svelte:head>

<main class="min-h-dvh flex flex-col items-center justify-center gap-6 p-8 text-center">
	<h1 class="text-4xl sm:text-5xl">Hello, {name}</h1>

	<p class="max-w-md text-sm opacity-60">Your dashboard is coming soon.</p>

	<a
		href="/"
		class="rounded-full border border-border bg-surface-card px-5 py-2 text-sm transition-colors hover:bg-surface-card-hover"
	>
		Back
	</a>
</main>
