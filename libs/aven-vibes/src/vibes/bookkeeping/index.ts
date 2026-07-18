import type { UiFixtureShell } from '../../engine/types.js'
import bookkeepingInterface from './interface.json'
import bookkeepingLogic from './logic.js?raw'
import bookkeepingSource from './source.json'
import { bookkeepingStyle } from './style.js'
import bookkeepingTools from './tools.json'
import { bookkeepingView } from './view.js'

export const bookkeepingShell: UiFixtureShell = {
	view: bookkeepingView,
	style: bookkeepingStyle,
	source: bookkeepingSource as Record<string, unknown>,
	interface: bookkeepingInterface,
	logic: bookkeepingLogic
}

export function createBookkeepingShell(): UiFixtureShell {
	return bookkeepingShell
}

export { bookkeepingLogic, bookkeepingSource, bookkeepingStyle, bookkeepingTools, bookkeepingView }
