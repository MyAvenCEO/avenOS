<script lang="ts">
import { page } from '$app/state'
import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'
import { developerDocs, founderDocs } from '$lib/docs/self-collection'

let { children } = $props()

const groups = [
	{ label: 'Founders', docs: founderDocs, base: '/docs/self/founders' },
	{ label: 'Developers', docs: developerDocs, base: '/docs/self/developers' }
] as const

const path = $derived(page.url.pathname)
const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>Self — documentation · AvenOS</title>
</svelte:head>

<DocsChapterLayout chapterTitle="Self & device identity" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
