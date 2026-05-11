/**
 * Single local-first primitive for accounts after identity material is known:
 * - signup / signin: passkey (via `signIn({ type: 'passkey', ... })`) supplies PRF-derived `agentSecret`.
 * - bootstrap: secret-key material (sync process or browser secret-key dev) — see `account-authentication-types.md`.
 * mode: signup → load or create | signin → load only | bootstrap → load or create
 */
import { ensureProfileForNewAccount as defaultEnsureProfileForNewAccount } from '@AvenOS/db'
import { createAccountWithSecret, loadAccount } from '@MaiaOS/peer'
import { cojsonInternals } from 'cojson'
import { WasmCrypto } from 'cojson/crypto/WasmCrypto'

const { accountHeaderForInitialAgentSecret, idforHeader } = cojsonInternals

/**
 * @param {Object} options
 * @param {{ agentSecret: import('cojson').AgentSecret, accountID?: string }} options.identity
 * @param {Object} options.storage - from getStorage()
 * @param {Array} options.peers - from setupSyncPeers().peers
 * @param {string} [options.name]
 * @param {Function} [options.migration]
 * @param {Function} [options.ensureProfileForNewAccount] - defaults to `migration`; pass `@AvenOS/db` helper when `migration` is custom and does not create `profile`
 * @param {'signup'|'signin'|'bootstrap'} options.mode
 * @param {{ setNode?: (n: unknown) => void }} [options.syncSetup]
 * @returns {{ accountID: string, agentSecret: import('cojson').AgentSecret, loadingPromise: Promise<{node: import('cojson').LocalNode, account: import('cojson').RawAccount, accountID: string, wasCreated: boolean}> }}
 */
export async function ensureAccount({
	identity,
	storage,
	peers = [],
	name,
	migration = defaultEnsureProfileForNewAccount,
	ensureProfileForNewAccount = migration,
	mode,
	syncSetup = null
} = {}) {
	if (!identity?.agentSecret) {
		throw new Error('ensureAccount: identity.agentSecret is required')
	}
	if (!['signup', 'signin', 'bootstrap'].includes(mode)) {
		throw new Error(`ensureAccount: invalid mode ${mode}`)
	}

	const crypto = await WasmCrypto.create()
	const accountID =
		identity.accountID ??
		idforHeader(accountHeaderForInitialAgentSecret(identity.agentSecret, crypto), crypto)

	const setNode =
		syncSetup && typeof syncSetup.setNode === 'function' ? syncSetup.setNode.bind(syncSetup) : null

	const loadingPromise = (async () => {
		try {
			const loadResult = await loadAccount({
				accountID,
				agentSecret: identity.agentSecret,
				peers,
				storage,
				migration,
				ensureProfileForNewAccount
			})
			if (setNode) setNode(loadResult.node)
			return {
				node: loadResult.node,
				account: loadResult.account,
				accountID: loadResult.accountID,
				wasCreated: false
			}
		} catch (err) {
			// Accept either the wrapped isAccountNotFound flag (coID.js loadAccount catch) or the raw
			// CoJSON message — in the browser the wrap sometimes does not run (peers populate after
			// AVEN_OS_SEED rotation, or the app bundle is older than the @MaiaOS/peer source). Either
			// way, "unavailable from all peers" + bootstrap/signup means: create locally + sync out.
			const rawMsg = typeof err?.message === 'string' ? err.message : ''
			const isNotFound =
				err?.isAccountNotFound === true ||
				rawMsg.includes('Account not found in storage') ||
				rawMsg.includes('Account unavailable from all peers')
			if (!isNotFound) throw err
			if (mode === 'signin') throw err
			const createResult = await createAccountWithSecret({
				agentSecret: identity.agentSecret,
				name,
				peers,
				storage,
				migration,
				ensureProfileForNewAccount
			})
			if (setNode) setNode(createResult.node)
			return {
				node: createResult.node,
				account: createResult.account,
				accountID: createResult.accountID,
				wasCreated: true
			}
		}
	})()

	return {
		accountID,
		agentSecret: identity.agentSecret,
		loadingPromise
	}
}
