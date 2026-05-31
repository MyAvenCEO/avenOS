import type { AsideRouteNavSection } from '$lib/ui/aside-nav'
import { t } from '$lib/i18n'

export type VaultNavSection = AsideRouteNavSection

export function vaultNavSections(): VaultNavSection[] {
	return [
		{
			title: t('vaultNav.category'),
			items: [
				{
					href: '/vault/secrets',
					label: t('vaultNav.secrets'),
					match: (p) => p.startsWith('/vault/secrets'),
				},
			],
		},
	]
}
