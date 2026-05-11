/**
 * @avenos/self - Self-sovereign identity: passkey (WebAuthn PRF) and secret-key bootstrap
 *
 * STRICT: PRF required for passkey paths, no fallbacks
 */

export { getStorage } from '@MaiaOS/storage'
export { ensureAccount } from './ensure-account.js'
export {
	isPRFSupported,
	requirePRFSupport
} from './feature-detection.js'
export { createPasskeyWithPRF, evaluatePRF } from './prf-adapter.js'
export { getExistingPasskey } from './prf-evaluator.js'
export { generateAgentCredentials } from './self.js'
export { signIn } from './sign-in.js'
export {
	arrayBufferToBase64,
	base64ToArrayBuffer,
	base64UrlToArrayBuffer,
	isValidAccountID,
	stringToUint8Array,
	uint8ArrayToHex
} from './utils.js'
