import type { UiFixtureShell } from '../../types.js'
import todoInterface from './interface.json'
import { todoLogic } from './logic.ts'
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

export { todoLogic } from './logic.ts'
export { todoView } from './view.js'
export { todoStyle } from './style.js'
export { default as todoSource } from './source.json'
