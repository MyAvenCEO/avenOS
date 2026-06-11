import type { UiFixtureShell } from '../../engine/types.js'
import invoiceInterface from './interface.json'
import invoiceLogic from './logic.js?raw'
import invoiceSource from './source.json'
import { invoiceStyle } from './style.js'
import { invoiceView } from './view.js'

export const invoiceShell: UiFixtureShell = {
	view: invoiceView,
	style: invoiceStyle,
	source: invoiceSource as Record<string, unknown>,
	interface: invoiceInterface,
	logic: invoiceLogic
}

export function createInvoiceShell(): UiFixtureShell {
	return invoiceShell
}

export { default as invoiceSource } from './source.json'
export { invoiceStyle } from './style.js'
export { invoiceView } from './view.js'
export { invoiceLogic }
