import type { UiFixtureShell } from '../../engine/types.js'
import todoInterface from './interface.json'
import todoLogic from './logic.js?raw'
import todoSource from './source.json'
import { todoStyle } from './style.js'
import { todoView } from './view.js'

export const todosShell: UiFixtureShell = {
	view: todoView,
	style: todoStyle,
	source: todoSource as Record<string, unknown>,
	interface: todoInterface,
	logic: todoLogic,
}

export function createTodosShell(): UiFixtureShell {
	return todosShell
}

export { todoLogic }
export { todoView } from './view.js'
export { todoStyle } from './style.js'
export { default as todoSource } from './source.json'
