import type { UiFixtureShell } from '../../engine/types.js'
import { makeDocShell } from '../_doc/index.js'
import bankStatementSource from './source.json'

export const bankStatementShell: UiFixtureShell = makeDocShell(
	bankStatementSource as Record<string, unknown>
)

export function createBankStatementShell(): UiFixtureShell {
	return bankStatementShell
}

export { default as bankStatementDoctype } from './doctype.json'
export { mapBankStatementToView } from './mapper.js'
export { bankStatementView } from './view.js'
