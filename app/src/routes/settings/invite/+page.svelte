<script lang="ts">
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import { isTauriRuntime } from '$lib/sandbox/tauri-vibe-webview'
	import InviteAdminPanel from '$lib/self/InviteAdminPanel.svelte'
	import { deviceSession } from '$lib/settings/device-session-store'

	const unlocked = $derived($deviceSession.kind === 'unlocked')
	const tauri = $derived(browser && isTauriRuntime())
</script>

<div class="flex w-full max-w-2xl flex-col gap-6">
	<header class="flex flex-col gap-1">
		<h1 class="text-lg font-semibold">{t('nav.invite')}</h1>
		<p class="text-muted-foreground text-sm">{t('invite.settingsSubtitle')}</p>
	</header>

	{#if !tauri || !unlocked}
		<p class="text-muted-foreground text-sm">{t('sparks.needsDesktop')}</p>
	{:else}
		<InviteAdminPanel />
	{/if}
</div>
