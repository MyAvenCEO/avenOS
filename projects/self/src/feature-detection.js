/**
 * Feature detection for WebAuthn PRF support
 * STRICT: PRF is REQUIRED - no fallbacks
 */

/**
 * Check if WebAuthn PRF extension is supported
 * STRICT: Throws error if not supported
 *
 * @returns {Promise<boolean>}
 * @throws {Error} If PRF not supported with instructions for user
 */
export async function isPRFSupported() {
	if (globalThis.__TAURI_INTERNALS__) {
		return true
	}

	// Check if WebAuthn is available
	if (!globalThis.window?.PublicKeyCredential) {
		throw new Error(
			'WebAuthn not supported. Please use:\n' +
				'- Chrome on macOS/Linux/Windows 11\n' +
				'- Safari on macOS 13+/iOS 16+\n' +
				'Firefox and Windows 10 are NOT supported.'
		)
	}

	// Check if PRF extension is available
	try {
		const available = await PublicKeyCredential.isConditionalMediationAvailable?.()
		if (!available) {
			throw new Error(
				'WebAuthn PRF not supported. Please use:\n' +
					'- Chrome on macOS/Linux/Windows 11\n' +
					'- Safari on macOS 13+/iOS 16+\n' +
					'Firefox and Windows 10 are NOT supported.'
			)
		}
		return true
	} catch (_error) {
		throw new Error(
			'WebAuthn PRF not supported. Please use:\n' +
				'- Chrome on macOS/Linux/Windows 11\n' +
				'- Safari on macOS 13+/iOS 16+\n' +
				'Firefox and Windows 10 are NOT supported.'
		)
	}
}

/**
 * Strict validation before any passkey operation
 * Throws if PRF not supported
 */
export async function requirePRFSupport() {
	await isPRFSupported()
}
