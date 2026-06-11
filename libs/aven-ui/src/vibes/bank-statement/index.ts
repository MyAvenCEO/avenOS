import type { UiFixtureShell } from '../../engine/types.js'
import bankStatementInterface from './interface.json'
import bankStatementLogic from './logic.js?raw'
import bankStatementSource from './source.json'
import { bankStatementStyle } from './style.js'
import { bankStatementView } from './view.js'

export const bankStatementShell: UiFixtureShell = {
	view: bankStatementView,
	style: bankStatementStyle,
	source: bankStatementSource as Record<string, unknown>,
	interface: bankStatementInterface,
	logic: bankStatementLogic
}

export function createBankStatementShell(): UiFixtureShell {
	return bankStatementShell
}

export { default as bankStatementSource } from './source.json'
export { bankStatementStyle } from './style.js'
export { bankStatementView } from './view.js'
export { bankStatementLogic }
