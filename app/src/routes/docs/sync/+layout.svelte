<script lang="ts">
	import { page } from '$app/state'
	import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
	import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'
	import { developerDocs } from '$lib/docs/sync-collection'

	let { children } = $props()

	const groups = [{ label: 'Developers', docs: developerDocs, base: '/docs/sync/developers' }] as const

	const path = $derived(page.url.pathname)
	const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>Sync — documentation · AvenOS</title>
</svelte:head>

<DocsChapterLayout chapterTitle="Sync" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
