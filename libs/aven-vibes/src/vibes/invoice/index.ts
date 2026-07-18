import type { UiFixtureShell } from '../../engine/types.js'
import { makeDocShell } from '../_doc/index.js'
import invoiceSource from './source.json'

export const invoiceShell: UiFixtureShell = makeDocShell(invoiceSource as Record<string, unknown>)

export function createInvoiceShell(): UiFixtureShell {
	return invoiceShell
}

export { default as invoiceDoctype } from './doctype.json'
export { mapInvoiceToView } from './mapper.js'
export { invoiceView } from './view.js'
