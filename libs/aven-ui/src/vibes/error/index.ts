import type { UiFixtureShell } from '../../types.js'
import errorInterface from './interface.json'
import { errorLogic } from './logic.ts'
import errorSource from './source.json'
import { errorStyle } from './style.js'
import { errorView } from './view.js'

export const errorShell: UiFixtureShell = {
	view: errorView,
	style: errorStyle,
	source: errorSource as Record<string, unknown>,
	interface: errorInterface,
	logic: errorLogic,
}

export function createErrorShell(): UiFixtureShell {
	return errorShell
}

export { errorLogic } from './logic.ts'
export { errorView } from './view.js'
export { errorStyle } from './style.js'
export { default as errorSource } from './source.json'
