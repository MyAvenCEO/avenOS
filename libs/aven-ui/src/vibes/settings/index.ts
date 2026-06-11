import type { UiFixtureShell } from '../../engine/types.js'
import settingsInterface from './interface.json'
import settingsLogic from './logic.js?raw'
import settingsSource from './source.json'
import { settingsStyle } from './style.js'
import { settingsView } from './view.js'

export const settingsShell: UiFixtureShell = {
	view: settingsView,
	style: settingsStyle,
	source: settingsSource as Record<string, unknown>,
	interface: settingsInterface,
	logic: settingsLogic
}

export function createSettingsShell(): UiFixtureShell {
	return settingsShell
}

export { default as settingsSource } from './source.json'
export { settingsStyle } from './style.js'
export { settingsView } from './view.js'
export { settingsLogic }
