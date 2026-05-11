/**
 * @see projects/self/src/ensure-account.js
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test'
import { cojsonInternals } from 'cojson'
import { WasmCrypto } from 'cojson/crypto/WasmCrypto'

const { accountHeaderForInitialAgentSecret, idforHeader } = cojsonInternals

const loadAccount = mock(() =>
	Promise.resolve({ node: { syncManager: {} }, account: { id: 'co_z1' }, accountID: 'co_z1' })
)
const createAccountWithSecret = mock(() =>
	Promise.resolve({ node: { syncManager: {} }, account: { id: 'co_z1' }, accountID: 'co_z1' })
)

mock.module('@MaiaOS/peer', () => ({
	loadAccount,
	createAccountWithSecret,
	setupSyncPeers: () => ({ peers: [] })
}))
mock.module('@AvenOS/db', () => ({
	ensureProfileForNewAccount: async () => {}
}))

const { ensureAccount } = await import('../src/ensure-account.js')

async function makeIdentity() {
	const crypto = await WasmCrypto.create()
	const agentSecret = crypto.newRandomAgentSecret()
	const accountID = idforHeader(accountHeaderForInitialAgentSecret(agentSecret, crypto), crypto)
	return { agentSecret, accountID }
}

describe('ensureAccount', () => {
	beforeEach(() => {
		loadAccount.mockClear()
		createAccountWithSecret.mockClear()
		loadAccount.mockImplementation(() =>
			Promise.resolve({
				node: { syncManager: {} },
				account: { id: 'co_z1' },
				accountID: 'co_z1'
			})
		)
		createAccountWithSecret.mockImplementation(() =>
			Promise.resolve({
				node: { syncManager: {} },
				account: { id: 'co_z1' },
				accountID: 'co_z1'
			})
		)
	})

	test('signin does not create when account is missing (isAccountNotFound)', async () => {
		loadAccount.mockImplementation(() =>
			Promise.reject(Object.assign(new Error('not found'), { isAccountNotFound: true }))
		)
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'signin',
			identity: { agentSecret },
			storage: {},
			peers: []
		})
		await expect(loadingPromise).rejects.toMatchObject({ isAccountNotFound: true })
		expect(createAccountWithSecret).not.toHaveBeenCalled()
	})

	test('signup creates when account is missing', async () => {
		loadAccount.mockImplementation(() =>
			Promise.reject(Object.assign(new Error('not found'), { isAccountNotFound: true }))
		)
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'signup',
			identity: { agentSecret },
			storage: {},
			peers: [],
			name: 'Test User'
		})
		const resolved = await loadingPromise
		expect(resolved.wasCreated).toBe(true)
		expect(createAccountWithSecret).toHaveBeenCalled()
	})

	test('bootstrap load succeeds', async () => {
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'bootstrap',
			identity: { agentSecret },
			storage: {},
			peers: [],
			name: 'Agent'
		})
		const resolved = await loadingPromise
		expect(resolved.wasCreated).toBe(false)
		expect(createAccountWithSecret).not.toHaveBeenCalled()
	})

	test('bootstrap creates when account is missing (same as signup for create path)', async () => {
		loadAccount.mockImplementation(() =>
			Promise.reject(Object.assign(new Error('not found'), { isAccountNotFound: true }))
		)
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'bootstrap',
			identity: { agentSecret },
			storage: {},
			peers: [],
			name: 'Agent'
		})
		const resolved = await loadingPromise
		expect(resolved.wasCreated).toBe(true)
		expect(createAccountWithSecret).toHaveBeenCalled()
	})

	test('signup returns same accountID as identity when accountID is preset (env-style)', async () => {
		const { agentSecret, accountID } = await makeIdentity()
		loadAccount.mockImplementation(() =>
			Promise.reject(Object.assign(new Error('not found'), { isAccountNotFound: true }))
		)
		const { accountID: outId, loadingPromise } = await ensureAccount({
			mode: 'signup',
			identity: { agentSecret, accountID },
			storage: {},
			peers: [],
			name: 'X'
		})
		expect(outId).toBe(accountID)
		const resolved = await loadingPromise
		expect(resolved.wasCreated).toBe(true)
		expect(createAccountWithSecret).toHaveBeenCalled()
	})

	test('bootstrap creates when load throws raw CoJSON "unavailable from all peers" (no flag)', async () => {
		loadAccount.mockImplementation(() =>
			Promise.reject(new Error('Account unavailable from all peers'))
		)
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'bootstrap',
			identity: { agentSecret },
			storage: {},
			peers: [],
			name: 'Agent'
		})
		await loadingPromise
		expect(createAccountWithSecret).toHaveBeenCalled()
	})

	test('signup creates when load throws raw CoJSON "unavailable from all peers" (no flag)', async () => {
		loadAccount.mockImplementation(() =>
			Promise.reject(new Error('Account unavailable from all peers'))
		)
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'signup',
			identity: { agentSecret },
			storage: {},
			peers: [],
			name: 'X'
		})
		await loadingPromise
		expect(createAccountWithSecret).toHaveBeenCalled()
	})

	test('signin never creates even when raw "unavailable from all peers" is thrown', async () => {
		loadAccount.mockImplementation(() =>
			Promise.reject(new Error('Account unavailable from all peers'))
		)
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'signin',
			identity: { agentSecret },
			storage: {},
			peers: []
		})
		await expect(loadingPromise).rejects.toThrow(/unavailable from all peers/)
		expect(createAccountWithSecret).not.toHaveBeenCalled()
	})

	test('unrelated errors still propagate (e.g. signature mismatch)', async () => {
		loadAccount.mockImplementation(() => Promise.reject(new Error('Signature verification failed')))
		const { agentSecret } = await makeIdentity()
		const { loadingPromise } = await ensureAccount({
			mode: 'bootstrap',
			identity: { agentSecret },
			storage: {},
			peers: []
		})
		await expect(loadingPromise).rejects.toThrow(/Signature/)
		expect(createAccountWithSecret).not.toHaveBeenCalled()
	})
})
