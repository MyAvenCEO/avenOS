import type { Context } from 'hono'
import { auth } from './auth'
import { ChainService, KyselyChainStore, SymbolicSigner } from './chain'
import { db } from './db'
import { publish } from './events'

// HTTP wiring for the internal chain (board 0088). Thin Hono handlers over the production
// Kysely store + symbolic signer. Mint + the recipient list are admin-gated
// (session.user.role === 'admin'); the caller address is derived from the session user.
// The pure chain logic lives in `chain.ts` (tested in isolation, no auth/env at import).

const SIGNER_SECRET =
	process.env.CHAIN_SIGNER_SECRET ?? process.env.BETTER_AUTH_SECRET ?? 'aven-chain-dev-secret'

function service(): ChainService {
	return new ChainService({
		store: new KyselyChainStore(),
		signer: new SymbolicSigner(SIGNER_SECRET),
		isAdmin: async (uid) => {
			const r = await db()
				.selectFrom('user')
				.select('role')
				.where('id', '=', uid)
				.executeTakeFirst()
			return r?.role === 'admin'
		}
	})
}

type SessionUser = { id: string; role?: string | null }

async function sessionUser(c: Context): Promise<SessionUser | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session?.user?.id) return null
	return { id: session.user.id, role: (session.user as { role?: string | null }).role }
}

/** GET /api/chain/account — my address, pubkey, aEUR balance (lazily ensures the account). */
export async function chainAccount(c: Context): Promise<Response> {
	const user = await sessionUser(c)
	if (!user) return c.json({ error: 'unauthorized' }, 401)
	const svc = service()
	const acct = await svc.ensureAccount(user.id)
	const balance = await svc.getBalanceByAddress(acct.address)
	return c.json({
		address: acct.address,
		pubkey: acct.pubkey,
		balance,
		isAdmin: user.role === 'admin'
	})
}

/** GET /api/chain/token — aEUR metadata (symbol, decimals, total supply, minter). */
export async function chainToken(c: Context): Promise<Response> {
	const user = await sessionUser(c)
	if (!user) return c.json({ error: 'unauthorized' }, 401)
	const token = await service().getToken()
	return c.json(token)
}

/** POST /api/chain/mint — ADMIN-ONLY. Body: { amount } (minor units), optional { toUserId }. */
export async function chainMint(c: Context): Promise<Response> {
	const user = await sessionUser(c)
	if (!user) return c.json({ error: 'unauthorized' }, 401)
	if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
	const body = (await c.req.json().catch(() => null)) as {
		amount?: number
		toUserId?: string
	} | null
	if (typeof body?.amount !== 'number')
		return c.json({ error: 'amount (minor units) required' }, 400)
	try {
		const tx = await service().mint(user.id, body.amount, body.toUserId)
		publish(user.id, { entity: 'chain' })
		if (body.toUserId) publish(body.toUserId, { entity: 'chain' })
		return c.json({ ok: true, tx })
	} catch (e) {
		return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
	}
}

/** POST /api/chain/transfer — Body: { toAddress, amount } (minor units). */
export async function chainTransfer(c: Context): Promise<Response> {
	const user = await sessionUser(c)
	if (!user) return c.json({ error: 'unauthorized' }, 401)
	const body = (await c.req.json().catch(() => null)) as {
		toAddress?: string
		amount?: number
	} | null
	if (!body?.toAddress || typeof body.amount !== 'number') {
		return c.json({ error: 'toAddress and amount (minor units) required' }, 400)
	}
	const svc = service()
	const store = new KyselyChainStore()
	try {
		const tx = await svc.transfer(user.id, body.toAddress, body.amount)
		publish(user.id, { entity: 'chain' })
		// Nudge the recipient's live queries too, if they have an account here.
		const recipient = await store.getAccountByAddress(body.toAddress)
		if (recipient) publish(recipient.user_id, { entity: 'chain' })
		return c.json({ ok: true, tx })
	} catch (e) {
		return c.json({ error: e instanceof Error ? e.message : String(e) }, 400)
	}
}

/** GET /api/chain/txs — the whole signed, hash-chained ledger (oldest first), each verified. */
export async function chainTxs(c: Context): Promise<Response> {
	const user = await sessionUser(c)
	if (!user) return c.json({ error: 'unauthorized' }, 401)
	const svc = service()
	const acct = await svc.ensureAccount(user.id)
	const txs = await svc.listTxs()
	return c.json({
		address: acct.address,
		txs: txs.map((t) => ({ ...t, verified: svc.verifyTx(t) }))
	})
}

/** GET /api/chain/users — ADMIN-ONLY recipient picker: every other user + their derived address. */
export async function chainUsers(c: Context): Promise<Response> {
	const user = await sessionUser(c)
	if (!user) return c.json({ error: 'unauthorized' }, 401)
	if (user.role !== 'admin') return c.json({ error: 'forbidden' }, 403)
	const signer = new SymbolicSigner(SIGNER_SECRET)
	const rows = await db().selectFrom('user').select(['id', 'email']).execute()
	return c.json({
		users: rows
			.filter((r) => r.id !== user.id)
			.map((r) => ({ id: r.id, email: r.email, address: signer.deriveAddress(r.id) }))
	})
}
