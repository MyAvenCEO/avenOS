import type { UiFixtureShell } from '../../engine/types.js'
import bankTransfersInterface from './interface.json'
import bankTransfersLogic from './logic.js?raw'
import bankTransfersSource from './source.json'
import { bankTransfersStyle } from './style.js'
import { bankTransfersView } from './view.js'

export const bankTransfersShell: UiFixtureShell = {
	view: bankTransfersView,
	style: bankTransfersStyle,
	source: bankTransfersSource as Record<string, unknown>,
	interface: bankTransfersInterface,
	logic: bankTransfersLogic,
}

export function createBankTransfersShell(): UiFixtureShell {
	return bankTransfersShell
}

export { bankTransfersLogic }
export { bankTransfersView } from './view.js'
export { bankTransfersStyle } from './style.js'
export { default as bankTransfersSource } from './source.json'
