import type { UiFixtureShell } from '../../engine/types.js'
import docInterface from './interface.json'
import docLogic from './logic.js?raw'
import { docStyle } from './style.js'
import { docView } from './view.js'

// Build a generic structured-document vibe shell around a DocView source. Every doctype reuses the
// SAME view/style/logic — only the source (its mapper's output) differs. board 0064.
export function makeDocShell(source: Record<string, unknown>): UiFixtureShell {
	return {
		view: docView,
		style: docStyle,
		source,
		interface: docInterface,
		logic: docLogic
	}
}

export type { DocView } from './types.js'
export { docLogic, docStyle, docView }
