<script lang="ts">
import { page } from '$app/state'
import { actorDocs } from '$lib/docs/actors-collection'
import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'

let { children } = $props()

const groups = [
	{ label: 'Architecture', docs: actorDocs, base: '/docs/actors/developers' }
] as const

const path = $derived(page.url.pathname)
const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>Actors — documentation · AvenOS</title>
</svelte:head>

<DocsChapterLayout chapterTitle="Actor system" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
