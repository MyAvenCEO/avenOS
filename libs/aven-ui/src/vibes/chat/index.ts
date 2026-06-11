import type { UiFixtureShell } from '../../engine/types.js'
import chatInterface from './interface.json'
import chatLogic from './logic.js?raw'
import chatSource from './source.json'
import { chatStyle } from './style.js'
import { chatView } from './view.js'

export const chatShell: UiFixtureShell = {
	view: chatView,
	style: chatStyle,
	source: chatSource as Record<string, unknown>,
	interface: chatInterface,
	logic: chatLogic
}

export function createChatShell(): UiFixtureShell {
	return chatShell
}

export { default as chatSource } from './source.json'
export { chatStyle } from './style.js'
export { chatView } from './view.js'
export { chatLogic }
