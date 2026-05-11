/**
 * Key factory for static agent credentials (Node/seed). Passkey flows live in `sign-in.js` (`signIn`).
 */

import { cojsonInternals } from 'cojson'
import { WasmCrypto } from 'cojson/crypto/WasmCrypto'

const { accountHeaderForInitialAgentSecret, idforHeader } = cojsonInternals

/**
 * Generate agent credentials (static credentials for server/edge runtimes)
 */
export async function generateAgentCredentials({ name = 'Maia Agent' } = {}) {
	const crypto = await WasmCrypto.create()
	const agentSecret = crypto.newRandomAgentSecret()
	const accountHeader = accountHeaderForInitialAgentSecret(agentSecret, crypto)
	const accountID = idforHeader(accountHeader, crypto)
	return {
		accountID,
		agentSecret,
		name
	}
}
