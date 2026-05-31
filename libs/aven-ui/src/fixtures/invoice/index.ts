import type { UiBundle } from '../../types.js'
import { buildInvoiceState } from './build-state.js'
import { invoiceStyle } from './style.js'
import { invoiceView } from './view.js'

export function createInvoiceBundle(): UiBundle {
	return {
		view: invoiceView,
		style: invoiceStyle,
		state: buildInvoiceState(),
	}
}

export { buildInvoiceState, demoSource } from './build-state.js'
export { invoiceView } from './view.js'
export { invoiceStyle } from './style.js'
