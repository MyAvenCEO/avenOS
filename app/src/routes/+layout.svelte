<script lang="ts">
import '../app.css'

/**
 * The whole shell. avenCITY renders full-screen and owns its own scene, so the
 * layout's only jobs are loading the stylesheet (fonts + the game's tokens) and
 * naming the window — there is still no gate and no chrome. The world moved to
 * /game and `/` is now a selector, so each page sets its own title.
 */
const { children } = $props()
</script>

<svelte:head>
	<title>avenOS</title>
	<link rel="icon" href="/favicon.png" type="image/png" sizes="32x32">
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="128x128">
</svelte:head>

{@render children()}
