import type { UiFixtureShell } from '../../engine/types.js'
import errorInterface from './interface.json'
import errorLogic from './logic.js?raw'
import errorSource from './source.json'
import { errorStyle } from './style.js'
import { errorView } from './view.js'

export const errorShell: UiFixtureShell = {
	view: errorView,
	style: errorStyle,
	source: errorSource as Record<string, unknown>,
	interface: errorInterface,
	logic: errorLogic
}

export function createErrorShell(): UiFixtureShell {
	return errorShell
}

export { default as errorSource } from './source.json'
export { errorStyle } from './style.js'
export { errorView } from './view.js'
export { errorLogic }
