import type { AsideRouteNavSection } from '$lib/ui/aside-nav'
import { t } from '$lib/i18n'

export type SelfNavItem = AsideRouteNavSection['items'][number]
export type SelfNavSection = AsideRouteNavSection

export function selfNavSections(): SelfNavSection[] {
	return [
		{
			title: t('selfNav.identities'),
			items: [
				{
					href: '/self/peers',
					label: t('selfNav.peers'),
					match: (p) => p.startsWith('/self/peers'),
				},
				{
					href: '/self/identity',
					label: t('selfNav.self'),
					match: (p) => p.startsWith('/self/identity'),
				},
			],
		},
		{
			title: t('selfNav.preferencesCategory'),
			items: [
				{
					href: '/self/preferences',
					label: t('selfNav.language'),
					match: (p) => p.startsWith('/self/preferences'),
				},
			],
		},
		{
			title: t('selfNav.sparks'),
			items: [
				{
					href: '/self/workspaces',
					label: t('selfNav.share'),
					match: (p) => p.startsWith('/self/workspaces'),
				},
			],
		},
		{
			title: t('selfNav.advanced'),
			items: [
				{
					href: '/self/advanced/network',
					label: t('selfNav.network'),
					match: (p) => p.startsWith('/self/advanced/network'),
				},
				{ href: '/self/db', label: t('selfNav.db'), match: (p) => p.startsWith('/self/db') },
			],
		},
	]
}

/** @deprecated use selfNavSections() for reactive locale */
export const selfNavSectionsStatic = selfNavSections()
