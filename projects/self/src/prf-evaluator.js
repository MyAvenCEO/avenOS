/**
 * PRF (Pseudo-Random Function) evaluator
 * Derives deterministic secrets from passkey using WebAuthn PRF extension
 */

/**
 * Evaluate PRF with existing passkey
 * Discovers passkey and evaluates PRF in one step
 *
 * @param {Object} options
 * @param {Uint8Array} options.salt - Salt for PRF evaluation
 * @param {string} options.rpId - Relying Party ID (defaults to current hostname)
 * @returns {Promise<{prfOutput: Uint8Array, credentialId: ArrayBuffer}>}
 */
export async function evaluatePRF({ salt, rpId = window.location.hostname }) {
	try {
		// Request authentication with PRF evaluation
		// IMPORTANT: authenticatorAttachment: 'platform' + hints: ['client-device']
		// ensures we only use platform authenticators (Touch ID, Face ID, Windows Hello)
		// and the UI prioritizes local device auth without showing QR/cross-platform options
		const assertion = await navigator.credentials.get({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rpId: rpId,
				userVerification: 'required',
				authenticatorAttachment: 'platform', // ONLY platform authenticators!
				// WebAuthn Level 3: Hint the browser UI to show platform authenticator
				hints: ['client-device'], // Prioritize local device, suppress QR code UI
				extensions: {
					prf: {
						eval: {
							first: salt // The salt we want to evaluate
						}
					}
				}
			},
			mediation: 'optional' // Show passkey picker
		})

		if (!assertion) {
			throw new Error('No passkey selected')
		}

		// Get PRF output from response
		const prfResults = assertion.getClientExtensionResults()?.prf
		if (!prfResults?.results?.first) {
			throw new Error('PRF evaluation failed: no results returned')
		}

		// Return PRF output and credential ID
		return {
			prfOutput: new Uint8Array(prfResults.results.first),
			credentialId: assertion.rawId
		}
	} catch (error) {
		throw new Error(`Failed to evaluate PRF: ${error.message}`)
	}
}

/**
 * Create a new passkey with PRF enabled
 *
 * @param {Object} options
 * @param {string} options.name - User-visible name
 * @param {Uint8Array} options.userId - User ID (will be used as salt later)
 * @param {string} options.rpId - Relying Party ID (defaults to current hostname)
 * @param {Uint8Array} [options.salt] - Optional: Evaluate PRF during creation
 * @returns {Promise<{credentialId: ArrayBuffer, response: Object, prfOutput?: Uint8Array}>}
 */
export async function createPasskeyWithPRF({
	name,
	userId,
	rpId = window.location.hostname,
	salt
}) {
	try {
		// Build PRF extension config
		const prfConfig = salt
			? {
					prf: {
						eval: {
							first: salt // Evaluate PRF during creation!
						}
					}
				}
			: {
					prf: {} // Just enable PRF without evaluation
				}

		const credential = await navigator.credentials.create({
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				rp: {
					name: 'Maia OS',
					id: rpId
				},
				user: {
					id: userId,
					name: name,
					displayName: name
				},
				pubKeyCredParams: [
					{ type: 'public-key', alg: -7 }, // ES256
					{ type: 'public-key', alg: -257 } // RS256
				],
				authenticatorSelection: {
					authenticatorAttachment: 'platform', // ONLY platform authenticators
					residentKey: 'required',
					userVerification: 'required'
				},
				// WebAuthn Level 3: Hint the browser UI to show platform authenticator first
				hints: ['client-device'], // Prioritize local device authenticator UI
				extensions: prfConfig
			}
		})

		// Verify PRF was enabled
		const extensionResults = credential.getClientExtensionResults()
		if (!extensionResults.prf?.enabled) {
			throw new Error('PRF extension not enabled on credential')
		}

		// Get PRF output if it was evaluated during creation
		const prfOutput = extensionResults.prf?.results?.first
			? new Uint8Array(extensionResults.prf.results.first)
			: null

		return {
			credentialId: credential.rawId,
			response: credential.response,
			prfOutput // May be null if salt wasn't provided
		}
	} catch (error) {
		throw new Error(`Failed to create passkey: ${error.message}`)
	}
}

/**
 * Get an existing passkey (for sign-in)
 * Uses optional mediation to show platform authenticator picker
 *
 * @param {string} rpId - Relying Party ID
 * @returns {Promise<{credentialId: ArrayBuffer, userId: Uint8Array}>}
 */
export async function getExistingPasskey(rpId = window.location.hostname) {
	try {
		const challenge = crypto.getRandomValues(new Uint8Array(32))

		const assertion = await navigator.credentials.get({
			publicKey: {
				challenge: challenge,
				rpId: rpId,
				userVerification: 'required'
			},
			mediation: 'optional' // Show passkey picker on button click
		})

		if (!assertion) {
			throw new Error('No passkey selected or available')
		}

		return {
			credentialId: assertion.rawId,
			userId: new Uint8Array(assertion.response.userHandle)
		}
	} catch (error) {
		// Better error messages
		if (error.name === 'NotAllowedError') {
			throw new Error('No passkey found. Please register a new passkey first.')
		}

		throw new Error(`Failed to get passkey: ${error.message}`)
	}
}
