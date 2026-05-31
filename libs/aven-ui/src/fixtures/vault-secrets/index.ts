import type { UiFixtureShell } from '../../types.js'
import vaultSecretsInterface from './interface.json'
import { vaultSecretsLogic } from './logic.ts'
import vaultSecretsSource from './source.json'
import { vaultSecretsStyle } from './style.js'
import { vaultSecretsView } from './view.js'

export const vaultSecretsShell: UiFixtureShell = {
	view: vaultSecretsView,
	style: vaultSecretsStyle,
	source: vaultSecretsSource as Record<string, unknown>,
	interface: vaultSecretsInterface,
	logic: vaultSecretsLogic,
}

export function createVaultSecretsShell(): UiFixtureShell {
	return vaultSecretsShell
}

export { vaultSecretsLogic } from './logic.ts'
export { vaultSecretsView } from './view.js'
export { vaultSecretsStyle } from './style.js'
export { default as vaultSecretsSource } from './source.json'
