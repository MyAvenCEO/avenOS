<script lang="ts">
import { onMount } from 'svelte'
import { goto } from '$app/navigation'

/**
 * The dashboard is the app. The selector this page used to be chose between
 * the avenCITY world and the dashboard; the world moved to ARCHIVE, so the
 * root simply forwards.
 */
onMount(() => {
	void goto('/dashboard', { replaceState: true })
})
</script>
