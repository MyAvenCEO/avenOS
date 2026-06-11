import type { UiFixtureShell } from '../../engine/types.js'
import membersInterface from './interface.json'
import membersLogic from './logic.js?raw'
import membersSource from './source.json'
import { membersStyle } from './style.js'
import { membersView } from './view.js'

export const membersShell: UiFixtureShell = {
	view: membersView,
	style: membersStyle,
	source: membersSource as Record<string, unknown>,
	interface: membersInterface,
	logic: membersLogic
}

export function createMembersShell(): UiFixtureShell {
	return membersShell
}

export { default as membersSource } from './source.json'
export { membersStyle } from './style.js'
export { membersView } from './view.js'
export { membersLogic }
