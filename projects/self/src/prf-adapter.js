/**
 * PRF implementation: browser WebAuthn vs Tauri native macOS passkey plugin
 */

let cachedModule = null

function isTauriRuntime() {
	return Boolean(globalThis.__TAURI_INTERNALS__)
}

async function loadPrfModule() {
	if (cachedModule) {
		return cachedModule
	}
	cachedModule = isTauriRuntime()
		? await import('./prf-tauri.js')
		: await import('./prf-evaluator.js')
	return cachedModule
}

export async function createPasskeyWithPRF(opts) {
	return (await loadPrfModule()).createPasskeyWithPRF(opts)
}

export async function evaluatePRF(opts) {
	return (await loadPrfModule()).evaluatePRF(opts)
}
