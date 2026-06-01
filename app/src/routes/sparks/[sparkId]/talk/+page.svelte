<script lang="ts">
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { jazzStore } from '$lib/jazz/store.svelte'
	import SparkTalkPanel from '$lib/sparks/SparkTalkPanel.svelte'

	const sparkParam = $derived(String((page.params as { sparkId?: string }).sparkId ?? ''))
	const decodedSparkId = $derived(decodeURIComponent(sparkParam))

	const sparksStore = jazzStore('sparks')

	function idsMatch(a: string, b: string): boolean {
		return a.trim().toLowerCase() === b.trim().toLowerCase()
	}

	const sparkMeta = $derived(sparksStore.rows.find((s) => idsMatch(s.spark_id, decodedSparkId)))
</script>

<svelte:head>
	<title>{t('sparks.talk.title')}{t('common.titleSuffix')}</title>
</svelte:head>

<div class="flex min-h-0 flex-1 flex-col">
	<SparkTalkPanel sparkId={decodedSparkId} sparkName={sparkMeta?.name} />
</div>
