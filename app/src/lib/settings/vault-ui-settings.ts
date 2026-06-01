import { invoke } from '@tauri-apps/api/core'
import { normalizeLocale, type SupportedLocale } from '$lib/i18n/locales'

export type VaultUiSettings = {
	locale: string
}

export async function vaultUiSettingsGet(): Promise<VaultUiSettings> {
	const res = await invoke<{ locale: string }>('plugin:self|vault_ui_settings_get')
	return { locale: normalizeLocale(res.locale) }
}

export async function vaultUiSettingsSetLocale(locale: SupportedLocale): Promise<void> {
	await invoke('plugin:self|vault_ui_settings_set_locale', { locale })
}
