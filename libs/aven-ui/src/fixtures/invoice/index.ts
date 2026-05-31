import type { UiFixtureShell } from '../../types.js'
import invoiceInterface from './interface.json'
import { invoiceLogic } from './logic.ts'
import invoiceSource from './source.json'
import { invoiceStyle } from './style.js'
import { invoiceView } from './view.js'

export const invoiceShell: UiFixtureShell = {
	view: invoiceView,
	style: invoiceStyle,
	source: invoiceSource as Record<string, unknown>,
	interface: invoiceInterface,
	logic: invoiceLogic,
}

export function createInvoiceShell(): UiFixtureShell {
	return invoiceShell
}

export { invoiceLogic } from './logic.ts'
export { invoiceView } from './view.js'
export { invoiceStyle } from './style.js'
export { default as invoiceSource } from './source.json'
