import type { UiFixtureShell } from '../../engine/types.js'
import bankingInterface from './interface.json'
import bankingLogic from './logic.js?raw'
import bankingSource from './source.json'
import { bankingStyle } from './style.js'
import { bankingView } from './view.js'

export const bankingShell: UiFixtureShell = {
	view: bankingView,
	style: bankingStyle,
	source: bankingSource as Record<string, unknown>,
	interface: bankingInterface,
	logic: bankingLogic
}

export function createBankingShell(): UiFixtureShell {
	return bankingShell
}

export { default as bankingSource } from './source.json'
export { bankingStyle } from './style.js'
export { bankingView } from './view.js'
export { bankingLogic }
