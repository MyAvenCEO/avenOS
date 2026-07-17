import { expect, test } from 'bun:test'
import {
	AEUR,
	ChainService,
	type ChainToken,
	GENESIS_HASH,
	InMemoryChainStore,
	SymbolicSigner
} from './chain'

// Slice 1 "money moves" e2e (board 0088), run against the in-memory store so it's fully
// deterministic and never touches Neon. Proves: deterministic addresses, admin-only mint,
// balances after mint+transfer, signed + hash-chained txs.

function freshService() {
	const store = new InMemoryChainStore()
	const signer = new SymbolicSigner('test-secret')
	// Seed the aEUR token exactly as migration 0016_chain does (minter unclaimed until first mint).
	const seed: ChainToken = {
		symbol: AEUR,
		name: 'avenEURO',
		decimals: 2,
		minter_address: null,
		total_supply: 0
	}
	const svc = new ChainService({
		store,
		signer,
		isAdmin: (userId) => userId === 'admin'
	})
	return { store, signer, svc, seed }
}

test('address derivation is deterministic per user and distinct across users', () => {
	const signer = new SymbolicSigner('test-secret')
	expect(signer.deriveAddress('admin')).toBe(signer.deriveAddress('admin'))
	expect(signer.deriveAddress('admin')).not.toBe(signer.deriveAddress('userB'))
	expect(signer.deriveAddress('admin')).toMatch(/^0x[0-9a-f]{40}$/)
})

test('mint is admin-only — a non-admin mint throws', async () => {
	const { svc, store, seed } = freshService()
	await store.putToken(seed)
	await expect(svc.mint('userB', 100000)).rejects.toThrow(/admin-only/)
})

test('money moves: admin mints 100000, transfers 5000 to userB → 95000 / 5000', async () => {
	const { svc, store, signer, seed } = freshService()
	await store.putToken(seed)

	const adminAddr = signer.deriveAddress('admin')
	const bAddr = signer.deriveAddress('userB')

	// Mint 1000.00 aEUR to admin, then send 50.00 to userB.
	await svc.mint('admin', 100000)
	await svc.transfer('admin', bAddr, 5000)

	expect(await svc.getBalanceByAddress(adminAddr)).toBe(95000)
	expect(await svc.getBalanceByAddress(bAddr)).toBe(5000)

	// Token supply grew by the mint; admin claimed the minter slot.
	const token = await svc.getToken()
	expect(token.total_supply).toBe(100000)
	expect(token.minter_address).toBe(adminAddr)

	// Exactly two txs, both signature-verified, and hash-chain-linked.
	const txs = await svc.listTxs()
	expect(txs.length).toBe(2)
	expect(txs.every((t) => svc.verifyTx(t))).toBe(true)
	expect(txs[0].prev_hash).toBe(GENESIS_HASH)
	expect(txs[1].prev_hash).toBe(txs[0].hash)
	expect(txs[0].kind).toBe('mint')
	expect(txs[1].kind).toBe('transfer')
})

test('a tampered tx fails verification (signature is real, not decorative)', async () => {
	const { svc, store, seed } = freshService()
	await store.putToken(seed)
	await svc.mint('admin', 100000)
	const [tx] = await svc.listTxs()
	expect(svc.verifyTx(tx)).toBe(true)
	// Flip the amount → the signature no longer matches the payload.
	expect(svc.verifyTx({ ...tx, amount: 999999 })).toBe(false)
})

test('transfer rejects an overdraft', async () => {
	const { svc, store, signer, seed } = freshService()
	await store.putToken(seed)
	const bAddr = signer.deriveAddress('userB')
	await expect(svc.transfer('admin', bAddr, 5000)).rejects.toThrow(/insufficient/)
})
