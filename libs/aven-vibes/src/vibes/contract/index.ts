import type { UiFixtureShell } from '../../engine/types.js'
import { makeDocShell } from '../_doc/index.js'
import contractSource from './source.json'

export const contractShell: UiFixtureShell = makeDocShell(contractSource as Record<string, unknown>)

export function createContractShell(): UiFixtureShell {
	return contractShell
}

export { default as contractDoctype } from './doctype.json'
export { mapContractToView } from './mapper.js'
export { contractView } from './view.js'
