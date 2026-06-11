<script lang="ts">
import { onMount } from 'svelte'
import { browser } from '$app/environment'
import { navigateAppTo } from '$lib/shell'

onMount(() => {
	if (!browser) return
	navigateAppTo('/settings/identity')
})
</script>
