/**
 * Tauri macOS native passkey + PRF (tauri-plugin-passkey → ASAuthorizationController).
 * Default RP ID: next.maia.city (must match Entitlements webcredentials and AASA on that host).
 */

import { invoke } from '@tauri-apps/api/core'
import { base64UrlToArrayBuffer } from './utils.js'

function pickPrf(result) {
	return result.prf_output ?? result.prfOutput
}

function pickRawId(result) {
	return result.raw_id ?? result.rawId
}

/**
 * @param {Object} options
 * @param {string} options.name
 * @param {Uint8Array} options.userId
 * @param {Uint8Array} options.salt
 * @param {string} [options.rpId]
 * @returns {Promise<{credentialId: ArrayBuffer, prfOutput: Uint8Array}>}
 */
export async function createPasskeyWithPRF({ name, userId, salt, rpId = 'next.maia.city' }) {
	const result = await invoke('plugin:tauri-plugin-passkey|register_passkey', {
		domain: rpId,
		challenge: Array.from(crypto.getRandomValues(new Uint8Array(32))),
		username: name,
		userId: Array.from(userId),
		salt: Array.from(salt)
	})

	const prf = pickPrf(result)
	if (!prf || prf.length === 0) {
		throw new Error('PRF extension not enabled on credential')
	}

	const rawId = pickRawId(result)
	if (!rawId || typeof rawId !== 'string') {
		throw new Error('Passkey registration failed: missing credential id')
	}

	return {
		credentialId: base64UrlToArrayBuffer(rawId),
		prfOutput: new Uint8Array(prf)
	}
}

/**
 * @param {Object} options
 * @param {Uint8Array} options.salt
 * @param {string} [options.rpId]
 * @returns {Promise<{prfOutput: Uint8Array, credentialId: ArrayBuffer}>}
 */
export async function evaluatePRF({ salt, rpId = 'next.maia.city' }) {
	const result = await invoke('plugin:tauri-plugin-passkey|login_passkey', {
		domain: rpId,
		challenge: Array.from(crypto.getRandomValues(new Uint8Array(32))),
		salt: Array.from(salt)
	})

	const prf = pickPrf(result)
	if (!prf || prf.length === 0) {
		throw new Error('PRF evaluation failed: no results returned')
	}

	const rawId = pickRawId(result)
	if (!rawId || typeof rawId !== 'string') {
		throw new Error('Passkey login failed: missing credential id')
	}

	return {
		prfOutput: new Uint8Array(prf),
		credentialId: base64UrlToArrayBuffer(rawId)
	}
}
