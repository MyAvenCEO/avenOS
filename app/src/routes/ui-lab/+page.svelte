<script lang="ts">
	import UiLabPanel from '$lib/aven-ui/UiLabPanel.svelte'
	import { t } from '$lib/i18n'
</script>

<svelte:head>
	<title>{t('uiLab.pageTitle')}{t('common.titleSuffix')}</title>
</svelte:head>

<main class="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-1 flex-col px-4 py-6 sm:px-6">
	<header class="mb-4 shrink-0">
		<h1 class="text-lg font-semibold tracking-tight">{t('uiLab.title')}</h1>
		<p class="text-muted-foreground mt-1 text-sm">{t('uiLab.subtitle')}</p>
	</header>
	<UiLabPanel />
</main>
