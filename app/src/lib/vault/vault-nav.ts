import type { AsideRouteNavSection } from '$lib/ui/aside-nav'
import { t } from '$lib/i18n'

export type VaultNavSection = AsideRouteNavSection

export function vaultNavSections(): VaultNavSection[] {
	return [
		{
			title: t('vaultNav.category'),
			items: [
				{
					href: '/vault/passwords',
					label: t('vaultNav.passwords'),
					match: (p) => p.startsWith('/vault/passwords'),
				},
				{
					href: '/vault/api-keys',
					label: t('vaultNav.apiKeys'),
					match: (p) => p.startsWith('/vault/api-keys'),
				},
			],
		},
	]
}
