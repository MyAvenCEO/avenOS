<script lang="ts">
	import { page } from '$app/state'
	import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
	import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'
	import { founderDocs, developerDocs } from '$lib/docs/network-collection'

	let { children } = $props()

	const groups = [
		{
			label: 'Concepts',
			docs: founderDocs,
			base: '/docs/network/founders',
		},
		{
			label: 'Developers',
			docs: developerDocs,
			base: '/docs/network/developers',
		},
	] as const

	const path = $derived(page.url.pathname)
	const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>My Network — documentation · AvenOS</title>
	<meta
		name="description"
		content="Pair devices, understand connection status, and learn how AvenOS keeps your private mesh connected."
	/>
</svelte:head>

<DocsChapterLayout chapterTitle="My Network" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
