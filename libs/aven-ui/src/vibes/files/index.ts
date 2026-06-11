import type { UiFixtureShell } from '../../engine/types.js'
import filesInterface from './interface.json'
import filesLogic from './logic.js?raw'
import filesSource from './source.json'
import { filesStyle } from './style.js'
import { filesView } from './view.js'

export const filesShell: UiFixtureShell = {
	view: filesView,
	style: filesStyle,
	source: filesSource as Record<string, unknown>,
	interface: filesInterface,
	logic: filesLogic
}

export function createFilesShell(): UiFixtureShell {
	return filesShell
}

export { default as filesSource } from './source.json'
export { filesStyle } from './style.js'
export { filesView } from './view.js'
export { filesLogic }
