<script lang="ts">
import { page } from '$app/state'

/**
 * The error page — mostly seen as a 404.
 *
 * Styled like the rest of the app and centered, with the one action that is
 * always right: back to the start. The status and message stay visible in
 * passing because they are the only clue when a route genuinely broke.
 */
</script>

<svelte:head>
	<title>{page.status} · avenOS</title>
</svelte:head>

<main class="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
	<p class="font-mono text-6xl opacity-20">{page.status}</p>
	<p class="text-sm opacity-60">
		{page.status === 404 ? 'Diese Seite gibt es nicht.' : (page.error?.message ?? 'Fehler')}
	</p>
	<a
		href="/"
		class="rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-90"
	>
		Zur Startseite
	</a>
</main>
