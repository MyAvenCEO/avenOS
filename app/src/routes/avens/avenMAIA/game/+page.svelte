<script lang="ts">
	import { AvenCityGame } from '@avenos/aven-city'
	import { t } from '$lib/i18n'
</script>

<svelte:head>
	<title>{t('nav.maiaCityGame')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="min-h-0 min-w-0 flex-1 overflow-hidden">
	<AvenCityGame />
</div>
