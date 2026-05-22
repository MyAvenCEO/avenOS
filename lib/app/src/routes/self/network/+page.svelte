<script lang="ts">
	import { goto } from '$app/navigation'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import { isIosHostedTauriShell } from '$lib/tauri/tauri-shell-platform'

	onMount(() => {
		if (!browser) return
		if (isTauriRuntime() && isIosHostedTauriShell()) {
			void goto('/self')
			return
		}
		void goto('/self/peers')
	})
</script>
