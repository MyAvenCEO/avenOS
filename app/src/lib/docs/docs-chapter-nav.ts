import type { AsideNavSection } from '$lib/ui/aside-nav'

export type DocChapterNavGroup = {
	label: string
	base: string
	docs: readonly { slug: string; title: string }[]
}

/** Build aside nav sections from docs chapter groups (founders / developers, etc.). */
export function asideNavSectionsFromDocGroups(
	groups: readonly DocChapterNavGroup[],
	path: string
): AsideNavSection[] {
	return groups.map((group) => ({
		title: group.label,
		items: group.docs.map((doc) => {
			const href = `${group.base}/${doc.slug}`
			return {
				href,
				label: doc.title,
				active: path === href,
				class: 'line-clamp-2 leading-snug'
			}
		})
	}))
}

/** Main column wrapper for docs chapter pages (wider than app settings pages). */
export const docsChapterContentClass =
	'mx-auto w-full min-w-0 max-w-[min(100%,90rem)] flex-1 px-1 py-4 sm:px-4 md:py-6'
