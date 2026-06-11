<script lang="ts">
import { page } from '$app/state'
import DocsChapterLayout from '$lib/docs/DocsChapterLayout.svelte'
import { asideNavSectionsFromDocGroups } from '$lib/docs/docs-chapter-nav'
import { developerDocs, founderDocs } from '$lib/docs/identities-collection'

let { children } = $props()

const groups = [
	{ label: 'Concepts', docs: founderDocs, base: '/docs/identities/founders' },
	{ label: 'Developers', docs: developerDocs, base: '/docs/identities/developers' }
] as const

const path = $derived(page.url.pathname)
const navSections = $derived(asideNavSectionsFromDocGroups(groups, path))
</script>

<svelte:head>
	<title>Identities — documentation · AvenOS</title>
</svelte:head>

<DocsChapterLayout chapterTitle="Identities" sections={navSections} routeKey={path}>
	{@render children()}
</DocsChapterLayout>
