<script lang="ts">
	import { page } from '$app/state'
	import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
	import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'
	import { founderDocs, developerDocs } from '$lib/docs/sparks-collection'

	let { children } = $props()

	const groups = [
		{ label: 'Concepts', docs: founderDocs, base: '/docs/sparks/founders' },
		{ label: 'Developers', docs: developerDocs, base: '/docs/sparks/developers' },
	] as const

	const path = $derived(page.url.pathname)
	const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>Sparks — documentation · AvenOS</title>
</svelte:head>

<DocsChapterLayout chapterTitle="Sparks" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
