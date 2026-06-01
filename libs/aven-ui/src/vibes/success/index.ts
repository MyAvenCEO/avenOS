import type { UiFixtureShell } from '../../types.js'
import successInterface from './interface.json'
import { successLogic } from './logic.ts'
import successSource from './source.json'
import { successStyle } from './style.js'
import { successView } from './view.js'

export const successShell: UiFixtureShell = {
	view: successView,
	style: successStyle,
	source: successSource as Record<string, unknown>,
	interface: successInterface,
	logic: successLogic,
}

export function createSuccessShell(): UiFixtureShell {
	return successShell
}

export { successLogic } from './logic.ts'
export { successView } from './view.js'
export { successStyle } from './style.js'
export { default as successSource } from './source.json'
