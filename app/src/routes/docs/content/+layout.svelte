<script lang="ts">
	import { page } from '$app/state'
	import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
	import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'
	import { overviewDocs, sheetDocs, productionDocs, storytellingDocs, promptsDocs } from '$lib/docs/content-collection'

	let { children } = $props()

	const groups = [
		{ label: 'Start here', docs: overviewDocs, base: '/docs/content/overview' },
		{ label: 'Identity sheet', docs: sheetDocs, base: '/docs/content/sheet' },
		{ label: 'Production', docs: productionDocs, base: '/docs/content/production' },
		{ label: 'Storytelling', docs: storytellingDocs, base: '/docs/content/storytelling' },
		{ label: 'Prompts', docs: promptsDocs, base: '/docs/content/prompts' },
	] as const

	const path = $derived(page.url.pathname)
	const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>Storytelling — documentation · AvenOS</title>
	<meta
		name="description"
		content="The World We Deserve bible — identity sheet, production, PAST storytelling, prompts, MaiaCity, and the episode test."
	/>
</svelte:head>

<DocsChapterLayout chapterTitle="Storytelling" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
