<script lang="ts">
	import { navigateAppTo } from '$lib/shell'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'

	onMount(() => {
		if (!browser) return
		navigateAppTo('/self/peers')
	})
</script>
