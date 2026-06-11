/** Shared left-aside navigation model (Self, Identities detail, DB explorer, …). */

export type AsideNavItem = {
	label: string
	active: boolean
	href?: string
	muted?: boolean
	class?: string
	'aria-current'?: 'page' | undefined
	'aria-pressed'?: boolean
	onclick?: (e: MouseEvent) => void
}

export type AsideNavSection = {
	title?: string
	items: AsideNavItem[]
	/** Shown when `items` is empty (e.g. DB table list before bootstrap). */
	emptyMessage?: string
}

export type AsideRouteNavItem = {
	href: string
	label: string
	match: (path: string) => boolean
}

export type AsideRouteNavSection = {
	title?: string
	items: AsideRouteNavItem[]
}

/** Map route-based nav config to render-ready sections for the current path. */
export function asideNavSectionsFromRoutes(
	sections: AsideRouteNavSection[],
	path: string
): AsideNavSection[] {
	return sections.map((section) => ({
		title: section.title,
		items: section.items.map((item) => ({
			href: item.href,
			label: item.label,
			active: item.match(path)
		}))
	}))
}

/** Default inner main column for aside-backed app pages (Self, Identities detail, …). */
export const asidePageContentClass = 'mx-auto w-full max-w-3xl px-4 pt-4 pb-8 sm:px-6 md:px-8'

/** Wider variant (e.g. Identities gallery). */
export const asidePageContentWideClass = 'mx-auto flex w-full max-w-5xl flex-col px-4 sm:px-6'
