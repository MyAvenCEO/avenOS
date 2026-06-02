import type { AsideRouteNavSection } from '$lib/ui/aside-nav'
import { t } from '$lib/i18n'

export type SettingsNavItem = AsideRouteNavSection['items'][number]
export type SettingsNavSection = AsideRouteNavSection

export function settingsNavSections(): SettingsNavSection[] {
	return [
		{
			title: t('selfNav.identities'),
			items: [
				{
					href: '/settings/identity',
					label: t('selfNav.self'),
					match: (p) => p.startsWith('/settings/identity'),
				},
				{
					href: '/settings/network',
					label: t('nav.peers'),
					match: (p) => p.startsWith('/settings/network'),
				},
				{
					href: '/settings/invite',
					label: t('nav.invite'),
					match: (p) => p.startsWith('/settings/invite'),
				},
			],
		},
		{
			title: t('vaultNav.title'),
			items: [
				{
					href: '/settings/vault/passwords',
					label: t('vaultNav.passwords'),
					match: (p) => p.startsWith('/settings/vault/passwords'),
				},
				{
					href: '/settings/vault/api-keys',
					label: t('vaultNav.apiKeys'),
					match: (p) => p.startsWith('/settings/vault/api-keys'),
				},
			],
		},
		{
			title: t('selfNav.preferencesCategory'),
			items: [
				{
					href: '/settings/preferences',
					label: t('selfNav.language'),
					match: (p) => p.startsWith('/settings/preferences'),
				},
			],
		},
		{
			title: t('selfNav.models'),
			items: [
				{
					href: '/settings/models',
					label: t('selfNav.localModels'),
					match: (p) => p.startsWith('/settings/models'),
				},
			],
		},
		{
			title: t('selfNav.advanced'),
			items: [
				{
					href: '/settings/advanced/network',
					label: t('selfNav.network'),
					match: (p) => p.startsWith('/settings/advanced/network'),
				},
				{
					href: '/settings/db',
					label: t('selfNav.db'),
					match: (p) => p.startsWith('/settings/db'),
				},
			],
		},
	]
}

/** @deprecated use settingsNavSections() for reactive locale */
export const settingsNavSectionsStatic = settingsNavSections()

/** Legacy alias */
export const selfNavSections = settingsNavSections
