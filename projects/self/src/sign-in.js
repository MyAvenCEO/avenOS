/**
 * Unified sign-in: **passkey** (`type` + `mode`) or **secretkey** (`source`: env or caller config).
 * CoValue storage comes from `getStorage()` (browser-opfs / pglite / postgres) — never coupled to identity kind.
 */

import { ensureProfileForNewAccount } from '@AvenOS/db'
import { createLogger } from '@MaiaOS/logs'
import { loadAccount, setupSyncPeers } from '@MaiaOS/peer'
import { getStorage } from '@MaiaOS/storage'
import { cojsonInternals } from 'cojson'
import { WasmCrypto } from 'cojson/crypto/WasmCrypto'
import { ensureAccount } from './ensure-account.js'
import { requirePRFSupport } from './feature-detection.js'
import { createPasskeyWithPRF, evaluatePRF } from './prf-adapter.js'
import { arrayBufferToBase64, stringToUint8Array } from './utils.js'

const selfLog = createLogger('self')

const { accountHeaderForInitialAgentSecret, idforHeader } = cojsonInternals

/**
 * @param {{ peers?: unknown[], wsPeer?: unknown, waitForPeer?: () => Promise<boolean> }|null} syncSetup
 * @param {number} [deadlineMs]
 */
async function waitForBrowserSyncPeers(syncSetup, deadlineMs = 25_000) {
	if (!syncSetup?.wsPeer) return
	const deadline = Date.now() + deadlineMs
	while (Date.now() < deadline && syncSetup.peers.length === 0) {
		if (typeof syncSetup.waitForPeer === 'function') {
			await syncSetup.waitForPeer()
		}
		if (syncSetup.peers.length > 0) return
		await new Promise((r) => setTimeout(r, 50))
	}
}

function resolveNodeSecretKeyEnv() {
	return {
		accountID: process.env.AVEN_OS_ACCOUNT,
		agentSecret: process.env.AVEN_OS_SECRET
	}
}

function resolveBrowserSecretKeyEnv() {
	const meta = typeof import.meta !== 'undefined' ? import.meta.env : {}
	const testAcc = meta.VITE_AVEN_TEST_ACCOUNT
	const testSec = meta.VITE_AVEN_TEST_SECRET
	if (testAcc && testSec) {
		return { accountID: testAcc, agentSecret: testSec }
	}
	return { accountID: undefined, agentSecret: undefined }
}

/**
 * @param {'envvars'|'config'} source
 * @param {{ accountID?: string, agentSecret?: unknown }} explicit
 */
function resolveSecretKeyMaterial(source, explicit) {
	if (source === 'config') {
		return { accountID: explicit.accountID, agentSecret: explicit.agentSecret }
	}
	if (source !== 'envvars') {
		throw new Error(`signIn: secretkey requires source 'envvars' or 'config'`)
	}
	if (typeof process !== 'undefined' && process.versions?.node) {
		return resolveNodeSecretKeyEnv()
	}
	return resolveBrowserSecretKeyEnv()
}

/**
 * @param {Object} options
 * @param {'passkey'|'secretkey'} options.type
 * @param {'webauthn'|'envvars'|'config'} [options.source] — secretkey only
 * @param {'signin'|'signup'|'bootstrap'} [options.mode] — passkey: signin | signup; secretkey uses bootstrap internally
 * @param {string} [options.name]
 * @param {string} [options.salt]
 * @param {string|null} [options.syncDomain]
 * @param {string} [options.createName]
 * @param {string} [options.accountID] — with source `config`
 * @param {import('cojson').AgentSecret} [options.agentSecret] — with source `config`
 * @param {string|null} [options.dbPath] — Node PGlite directory (sync server)
 */
export async function signIn(options = {}) {
	const {
		type,
		source: rawSource,
		mode,
		name,
		salt = 'maia.city',
		syncDomain = null,
		createName = 'Maia Agent',
		accountID: optAccountID,
		agentSecret: optAgentSecret,
		dbPath = null
	} = options

	if (type === 'passkey') {
		if (mode === 'signup') {
			return signUpWithPasskeyInternal({ name, salt })
		}
		if (mode === 'signin') {
			return signInWithPasskeyInternal({ salt })
		}
		throw new Error(`signIn: passkey requires mode 'signin' or 'signup'`)
	}

	if (type === 'secretkey') {
		const source = rawSource ?? 'envvars'
		const { accountID, agentSecret } = resolveSecretKeyMaterial(source, {
			accountID: optAccountID,
			agentSecret: optAgentSecret
		})
		if (!agentSecret) {
			throw new Error(
				source === 'config'
					? 'signIn: secretkey source config requires agentSecret'
					: typeof process !== 'undefined' && process.versions?.node
						? 'agentSecret is required. Set AVEN_OS_SECRET. Run `bun agent:generate`.'
						: 'agentSecret is required. Set VITE_AVEN_TEST_SECRET in .env for browser dev.'
			)
		}
		if (!accountID) {
			throw new Error(
				source === 'config'
					? 'signIn: secretkey source config requires accountID'
					: typeof process !== 'undefined' && process.versions?.node
						? 'accountID is required. Set AVEN_OS_ACCOUNT. Run `bun agent:generate`.'
						: 'accountID is required. Set VITE_AVEN_TEST_ACCOUNT in .env for browser dev.'
			)
		}

		const storage = dbPath != null ? await getStorage({ dbPath }) : await getStorage()
		const syncSetup = setupSyncPeers(syncDomain)
		const isNode = typeof process !== 'undefined' && !!process.versions?.node
		if (!isNode) {
			await waitForBrowserSyncPeers(syncSetup)
		}

		const {
			accountID: id,
			agentSecret: sec,
			loadingPromise
		} = await ensureAccount({
			mode: 'bootstrap',
			identity: { accountID, agentSecret },
			storage,
			peers: syncSetup?.peers ?? [],
			name: createName,
			syncSetup
		})

		const resolved = await loadingPromise
		if (resolved.accountID !== id) {
			throw new Error('CRITICAL: accountID mismatch after ensureAccount')
		}
		return {
			accountID: resolved.accountID,
			agentSecret: sec,
			node: resolved.node,
			account: resolved.account,
			wasCreated: resolved.wasCreated
		}
	}

	throw new Error(`signIn: unknown type ${type}`)
}

/**
 * @param {Object} options
 * @param {string} [options.name]
 * @param {string} [options.salt]
 */
async function signUpWithPasskeyInternal({ name, salt = 'maia.city' } = {}) {
	await requirePRFSupport()

	const saltBytes = stringToUint8Array(salt)
	const crypto = await WasmCrypto.create()
	const webCrypto = globalThis.crypto ?? globalThis.window?.crypto
	const passkeyName =
		name && typeof name === 'string' && name.trim()
			? name.trim()
			: `Traveler ${(webCrypto?.randomUUID?.() ?? '').slice(0, 8)}`

	const syncSetup = setupSyncPeers()

	const [{ credentialId, prfOutput }, storage] = await Promise.all([
		createPasskeyWithPRF({
			name: passkeyName,
			userId: globalThis.crypto.getRandomValues(new Uint8Array(32)),
			salt: saltBytes
		}),
		getStorage()
	])

	if (!prfOutput) {
		throw new Error('PRF evaluation failed')
	}

	const agentSecret = crypto.agentSecretFromSecretSeed(prfOutput)
	const accountHeader = accountHeaderForInitialAgentSecret(agentSecret, crypto)
	const computedAccountID = idforHeader(accountHeader, crypto)

	const {
		accountID,
		agentSecret: outSecret,
		loadingPromise: rawLoading
	} = await ensureAccount({
		mode: 'signup',
		identity: { agentSecret },
		storage,
		peers: syncSetup ? syncSetup.peers : [],
		name,
		migration: ensureProfileForNewAccount,
		syncSetup
	})

	if (computedAccountID !== accountID) {
		throw new Error(`CRITICAL: AccountID mismatch: computed ${computedAccountID} vs ${accountID}`)
	}

	const loadingPromise = rawLoading.then((r) => {
		if (r.accountID !== computedAccountID) {
			throw new Error(
				`CRITICAL: AccountID mismatch after create!\n  Computed: ${computedAccountID}\n  Created:  ${r.accountID}`
			)
		}
		return r
	})

	return {
		accountID,
		agentSecret: outSecret,
		credentialId: arrayBufferToBase64(credentialId),
		loadingPromise
	}
}

/**
 * @param {Object} options
 * @param {string} [options.salt]
 */
async function signInWithPasskeyInternal({ salt = 'maia.city' } = {}) {
	await requirePRFSupport()

	const saltBytes = stringToUint8Array(salt)
	const syncSetup = setupSyncPeers()

	const [{ prfOutput }, storage] = await Promise.all([
		evaluatePRF({ salt: saltBytes }),
		getStorage()
	])

	if (!prfOutput) {
		throw new Error('PRF evaluation failed during sign-in')
	}

	const crypto = await WasmCrypto.create()
	const agentSecret = crypto.agentSecretFromSecretSeed(prfOutput)
	const accountHeader = accountHeaderForInitialAgentSecret(agentSecret, crypto)
	const accountID = idforHeader(accountHeader, crypto)

	const waitForSyncPeers = async () => {
		if (syncSetup?.wsPeer) {
			if (typeof syncSetup.waitForPeer === 'function') {
				await syncSetup.waitForPeer()
			}
			const deadline = Date.now() + 30_000
			while (syncSetup.peers.length === 0 && Date.now() < deadline) {
				await new Promise((r) => setTimeout(r, 50))
			}
		}
	}

	const doLoad = () =>
		loadAccount({
			accountID,
			agentSecret,
			peers: syncSetup ? syncSetup.peers : [],
			storage,
			migration: ensureProfileForNewAccount,
			ensureProfileForNewAccount
		})

	const accountLoadingPromise = (async () => {
		const peerCount = syncSetup?.peers?.length ?? 0
		const hasWs = !!syncSetup?.wsPeer
		selfLog.log(
			`[signIn:passkey] storage-first loadAccount: hasWsPeer=${hasWs} syncPeers=${peerCount} account=${typeof accountID === 'string' ? `${accountID.slice(0, 12)}…` : '?'}`
		)
		if (!hasWs) {
			selfLog.warn(
				'[signIn:passkey] No sync WebSocket. Load relies on local OPFS/IndexedDB only; new browsers need peers for first hydrate.'
			)
		}

		try {
			let loadResult
			try {
				loadResult = await doLoad()
			} catch (first) {
				const firstMsg = typeof first?.message === 'string' ? first.message : ''
				const looksLikeNotFound =
					first?.isAccountNotFound === true ||
					firstMsg.includes('Account not found in storage') ||
					firstMsg.includes('Account unavailable from all peers')
				if (looksLikeNotFound && syncSetup?.wsPeer) {
					selfLog.warn(
						'[signIn:passkey] loadAccount failed (local miss). Waiting for peers then retry…',
						{ peersAtFail: syncSetup.peers.length, message: first?.message }
					)
					await new Promise((r) => setTimeout(r, 2000))
					await waitForSyncPeers()
					selfLog.log(`[signIn:passkey] retry loadAccount: syncPeers=${syncSetup.peers.length}`)
					loadResult = await doLoad()
				} else {
					throw first
				}
			}

			const { node, account } = loadResult
			if (syncSetup) syncSetup.setNode(node)
			selfLog.log('   💾 0 secrets retrieved from storage')
			selfLog.log('   ⚡ Everything computed deterministically!')
			return {
				accountID: account.id,
				agentSecret,
				node,
				account
			}
		} catch (loadError) {
			selfLog.error('[signIn:passkey] loadAccount failed', {
				message: loadError?.message,
				isAccountNotFound: loadError?.isAccountNotFound,
				peers: syncSetup?.peers?.length,
				hasWsPeer: !!syncSetup?.wsPeer,
				original: loadError?.originalError?.message
			})
			throw loadError
		}
	})()

	selfLog.log('🔄 Returning from passkey signIn immediately (account loading in background)...')
	return {
		accountID,
		agentSecret,
		loadingPromise: accountLoadingPromise
	}
}
