<script lang="ts">
import { AvenCityGame } from '@avenos/aven-city'

/**
 * The avenCITY world, now on its own sub-route. It renders full-screen and owns
 * its own three.js scene, so it stays a leaf: no chrome around it.
 */
</script>

<svelte:head>
	<title>avenCITY</title>
</svelte:head>

<!-- The game keeps its own typographic voice: the app-wide switch to Inter
     deliberately excludes this world, so its DOM text stays on the stack it
     was designed against. -->
<div style="font-family: 'AzeretMono', 'Chillax', ui-monospace, monospace" class="contents">
	<AvenCityGame />
</div>
