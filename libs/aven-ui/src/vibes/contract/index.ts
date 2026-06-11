import type { UiFixtureShell } from '../../engine/types.js'
import contractInterface from './interface.json'
import contractLogic from './logic.js?raw'
import contractSource from './source.json'
import { contractStyle } from './style.js'
import { contractView } from './view.js'

export const contractShell: UiFixtureShell = {
	view: contractView,
	style: contractStyle,
	source: contractSource as Record<string, unknown>,
	interface: contractInterface,
	logic: contractLogic
}

export function createContractShell(): UiFixtureShell {
	return contractShell
}

export { default as contractSource } from './source.json'
export { contractStyle } from './style.js'
export { contractView } from './view.js'
export { contractLogic }
