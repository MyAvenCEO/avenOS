import { createHash, createHmac, randomUUID } from 'node:crypto'
import { db } from './db'

// ───────────────────────────────────────────────────────────────────────────────
// Internal chain (`chain_*`) — a fake-but-realistic on-Postgres token ledger for aEUR
// (avenEURO). Slice 1 = "money moves": derive an address per user, mint (admin-only),
// transfer, balances, and a SIGNED + HASH-CHAINED tx history. board 0088.
//
// Everything is built behind three swappable ports so a REAL chain is a drop-in later
// with no interface churn (the whole point of the "plug-and-play" requirement):
//   • Signer  — sign/verify + address derivation. `SymbolicSigner` (HMAC) now;
//               an `Ed25519Signer` is the future drop-in (same interface).
//   • ChainStore — persistence. `KyselyChainStore` (Neon) in prod, `InMemoryChainStore`
//                  in tests (so the e2e test is deterministic and never touches Neon).
//   • ChainService — the aEUR "contract" logic (mint/transfer) over the two ports.
//
// Money is in INTEGER MINOR UNITS (cents): aEUR has 2 decimals, 100000 = 1000.00 aEUR.
// No floats anywhere in money math.
// ───────────────────────────────────────────────────────────────────────────────

export const AEUR = 'aEUR'
export const GENESIS_HASH = '0'.repeat(64)

export type Address = string // `0x` + 40 hex chars
export type TxKind = 'mint' | 'transfer'

export interface ChainAccount {
	address: Address
	user_id: string
	pubkey: string
}

export interface ChainToken {
	symbol: string
	name: string
	decimals: number
	/** The only address allowed to mint. Claimed by the first admin that mints. */
	minter_address: Address | null
	/** Total minted so far, in minor units. Grows on every mint → effectively unlimited. */
	total_supply: number
}

export interface ChainTx {
	id: string
	/** Monotonic sequence across the whole chain (1-based). */
	seq: number
	kind: TxKind
	token: string
	/** null for a mint (tokens created from nothing). */
	from_address: Address | null
	to_address: Address
	amount: number
	/** The address that signed/initiated the tx (== from_address for transfers). */
	caller: Address
	nonce: string
	signature: string
	prev_hash: string
	hash: string
}

export interface ChainContract {
	address: Address
	kind: string
	state: unknown
}

// ── Signer port ────────────────────────────────────────────────────────────────

/** Sign/verify + address derivation. Swap `SymbolicSigner` for a real `Ed25519Signer`
 *  later without changing any caller — `verify` takes only (payload, sig, address). */
export interface Signer {
	deriveAddress(userId: string): Address
	derivePubkey(userId: string): string
	sign(payload: string, userId: string): string
	verify(payload: string, signature: string, address: Address): boolean
}

function sha256hex(input: string): string {
	return createHash('sha256').update(input).digest('hex')
}

/** Symbolic (fake) signer. The server secret stands in for everyone's "private key";
 *  `verify` recomputes the HMAC from (address, payload) so it needs no per-user secret —
 *  exactly the shape a real signature check has. NOT cryptographically sound; it only
 *  has to be deterministic + tamper-evident for the fake chain. board 0088. */
export class SymbolicSigner implements Signer {
	constructor(private readonly secret: string) {}

	deriveAddress(userId: string): Address {
		return `0x${sha256hex(`aven:addr:${userId}`).slice(0, 40)}`
	}

	derivePubkey(userId: string): string {
		return `0x${sha256hex(`aven:pub:${userId}`)}`
	}

	sign(payload: string, userId: string): string {
		const addr = this.deriveAddress(userId)
		return createHmac('sha256', this.secret).update(`${addr}|${payload}`).digest('hex')
	}

	verify(payload: string, signature: string, address: Address): boolean {
		const expected = createHmac('sha256', this.secret).update(`${address}|${payload}`).digest('hex')
		return expected === signature
	}
}

// ── Store port ───────────────────────────────────────────────────────────────────

export interface ChainStore {
	getToken(symbol: string): Promise<ChainToken | null>
	putToken(token: ChainToken): Promise<void>
	getAccountByUser(userId: string): Promise<ChainAccount | null>
	getAccountByAddress(address: Address): Promise<ChainAccount | null>
	putAccount(account: ChainAccount): Promise<void>
	listAccounts(): Promise<ChainAccount[]>
	appendTx(tx: ChainTx): Promise<void>
	lastTx(): Promise<ChainTx | null>
	listTxs(): Promise<ChainTx[]>
}

/** In-memory store — the production-equivalent used by the deterministic e2e test. */
export class InMemoryChainStore implements ChainStore {
	private tokens = new Map<string, ChainToken>()
	private accounts = new Map<string, ChainAccount>() // keyed by address
	private txs: ChainTx[] = []

	async getToken(symbol: string): Promise<ChainToken | null> {
		return this.tokens.get(symbol) ?? null
	}
	async putToken(token: ChainToken): Promise<void> {
		this.tokens.set(token.symbol, { ...token })
	}
	async getAccountByUser(userId: string): Promise<ChainAccount | null> {
		for (const a of this.accounts.values()) if (a.user_id === userId) return a
		return null
	}
	async getAccountByAddress(address: Address): Promise<ChainAccount | null> {
		return this.accounts.get(address) ?? null
	}
	async putAccount(account: ChainAccount): Promise<void> {
		this.accounts.set(account.address, { ...account })
	}
	async listAccounts(): Promise<ChainAccount[]> {
		return [...this.accounts.values()]
	}
	async appendTx(tx: ChainTx): Promise<void> {
		this.txs.push({ ...tx })
	}
	async lastTx(): Promise<ChainTx | null> {
		return this.txs.length ? { ...this.txs[this.txs.length - 1] } : null
	}
	async listTxs(): Promise<ChainTx[]> {
		return this.txs.map((t) => ({ ...t }))
	}
}

/** Kysely/Neon-backed store (production). Amounts live in PG `bigint` columns which the
 *  driver returns as strings, so we Number()/String() at the boundary. board 0088. */
export class KyselyChainStore implements ChainStore {
	async getToken(symbol: string): Promise<ChainToken | null> {
		const r = await db()
			.selectFrom('chain_token')
			.selectAll()
			.where('symbol', '=', symbol)
			.executeTakeFirst()
		if (!r) return null
		return {
			symbol: r.symbol,
			name: r.name,
			decimals: r.decimals,
			minter_address: r.minter_address,
			total_supply: Number(r.total_supply)
		}
	}
	async putToken(token: ChainToken): Promise<void> {
		await db()
			.updateTable('chain_token')
			.set({
				name: token.name,
				decimals: token.decimals,
				minter_address: token.minter_address,
				total_supply: String(token.total_supply)
			})
			.where('symbol', '=', token.symbol)
			.execute()
	}
	async getAccountByUser(userId: string): Promise<ChainAccount | null> {
		const r = await db()
			.selectFrom('chain_account')
			.select(['address', 'user_id', 'pubkey'])
			.where('user_id', '=', userId)
			.executeTakeFirst()
		return r ?? null
	}
	async getAccountByAddress(address: Address): Promise<ChainAccount | null> {
		const r = await db()
			.selectFrom('chain_account')
			.select(['address', 'user_id', 'pubkey'])
			.where('address', '=', address)
			.executeTakeFirst()
		return r ?? null
	}
	async putAccount(account: ChainAccount): Promise<void> {
		await db()
			.insertInto('chain_account')
			.values({ ...account, created_at: new Date() })
			.onConflict((oc) => oc.column('address').doNothing())
			.execute()
	}
	async listAccounts(): Promise<ChainAccount[]> {
		return db().selectFrom('chain_account').select(['address', 'user_id', 'pubkey']).execute()
	}
	async appendTx(tx: ChainTx): Promise<void> {
		await db()
			.insertInto('chain_tx')
			.values({
				id: tx.id,
				seq: tx.seq,
				kind: tx.kind,
				token: tx.token,
				from_address: tx.from_address,
				to_address: tx.to_address,
				amount: String(tx.amount),
				caller: tx.caller,
				nonce: tx.nonce,
				signature: tx.signature,
				prev_hash: tx.prev_hash,
				hash: tx.hash,
				created_at: new Date()
			})
			.execute()
	}
	async lastTx(): Promise<ChainTx | null> {
		const r = await db()
			.selectFrom('chain_tx')
			.selectAll()
			.orderBy('seq', 'desc')
			.limit(1)
			.executeTakeFirst()
		return r ? rowToTx(r) : null
	}
	async listTxs(): Promise<ChainTx[]> {
		const rows = await db().selectFrom('chain_tx').selectAll().orderBy('seq', 'asc').execute()
		return rows.map(rowToTx)
	}
}

function rowToTx(r: {
	id: string
	seq: number
	kind: string
	token: string
	from_address: string | null
	to_address: string
	amount: string
	caller: string
	nonce: string
	signature: string
	prev_hash: string
	hash: string
}): ChainTx {
	return {
		id: r.id,
		seq: r.seq,
		kind: r.kind as TxKind,
		token: r.token,
		from_address: r.from_address,
		to_address: r.to_address,
		amount: Number(r.amount),
		caller: r.caller,
		nonce: r.nonce,
		signature: r.signature,
		prev_hash: r.prev_hash,
		hash: r.hash
	}
}

// ── Service (the aEUR "contract") ────────────────────────────────────────────────

/** The canonical, deterministic payload that gets signed AND hash-chained. Field order
 *  is fixed so sign/verify and the hash link are reproducible. */
function canonicalPayload(core: {
	seq: number
	kind: TxKind
	token: string
	from_address: Address | null
	to_address: Address
	amount: number
	nonce: string
	prev_hash: string
}): string {
	return JSON.stringify([
		core.seq,
		core.kind,
		core.token,
		core.from_address,
		core.to_address,
		core.amount,
		core.nonce,
		core.prev_hash
	])
}

function assertAmount(amount: number): void {
	if (!Number.isSafeInteger(amount) || amount <= 0) {
		throw new Error(`amount must be a positive integer (minor units), got ${amount}`)
	}
}

export interface ChainServiceOptions {
	store: ChainStore
	signer: Signer
	/** Mirrors `session.user.role === 'admin'`. Mint is gated on this. */
	isAdmin: (userId: string) => boolean | Promise<boolean>
	token?: string
}

export class ChainService {
	private readonly store: ChainStore
	private readonly signer: Signer
	private readonly isAdmin: (userId: string) => boolean | Promise<boolean>
	private readonly token: string

	constructor(opts: ChainServiceOptions) {
		this.store = opts.store
		this.signer = opts.signer
		this.isAdmin = opts.isAdmin
		this.token = opts.token ?? AEUR
	}

	/** Lazily create the caller's `chain_account` (idempotent), returning it. */
	async ensureAccount(userId: string): Promise<ChainAccount> {
		const existing = await this.store.getAccountByUser(userId)
		if (existing) return existing
		const account: ChainAccount = {
			address: this.signer.deriveAddress(userId),
			user_id: userId,
			pubkey: this.signer.derivePubkey(userId)
		}
		await this.store.putAccount(account)
		return account
	}

	async getToken(): Promise<ChainToken> {
		const t = await this.store.getToken(this.token)
		if (!t) throw new Error(`token ${this.token} not seeded`)
		return t
	}

	/** Balance (minor units) for an address: credits (to) − debits (from) over all txs. */
	async getBalanceByAddress(address: Address): Promise<number> {
		const txs = await this.store.listTxs()
		let bal = 0
		for (const t of txs) {
			if (t.token !== this.token) continue
			if (t.to_address === address) bal += t.amount
			if (t.from_address === address) bal -= t.amount
		}
		return bal
	}

	async getBalance(userId: string): Promise<number> {
		const acct = await this.ensureAccount(userId)
		return this.getBalanceByAddress(acct.address)
	}

	/** Append a signed, hash-chained tx. The single write path for mint + transfer. */
	private async append(core: {
		kind: TxKind
		from_address: Address | null
		to_address: Address
		amount: number
		callerUserId: string
	}): Promise<ChainTx> {
		const prev = await this.store.lastTx()
		const seq = (prev?.seq ?? 0) + 1
		const prev_hash = prev?.hash ?? GENESIS_HASH
		const nonce = randomUUID()
		const caller = this.signer.deriveAddress(core.callerUserId)
		const payload = canonicalPayload({
			seq,
			kind: core.kind,
			token: this.token,
			from_address: core.from_address,
			to_address: core.to_address,
			amount: core.amount,
			nonce,
			prev_hash
		})
		const signature = this.signer.sign(payload, core.callerUserId)
		const hash = sha256hex(`${prev_hash}|${payload}`)
		const tx: ChainTx = {
			id: randomUUID(),
			seq,
			kind: core.kind,
			token: this.token,
			from_address: core.from_address,
			to_address: core.to_address,
			amount: core.amount,
			caller,
			nonce,
			signature,
			prev_hash,
			hash
		}
		await this.store.appendTx(tx)
		return tx
	}

	/** Mint new aEUR. ADMIN-ONLY; the first admin to mint claims the token's minter slot.
	 *  Defaults to minting to the caller's own address. */
	async mint(callerUserId: string, amount: number, toUserId?: string): Promise<ChainTx> {
		if (!(await this.isAdmin(callerUserId))) throw new Error('forbidden: mint is admin-only')
		assertAmount(amount)
		const minter = await this.ensureAccount(callerUserId)
		const token = await this.getToken()
		if (token.minter_address && token.minter_address !== minter.address) {
			throw new Error('forbidden: not the token minter')
		}
		const to = toUserId ? await this.ensureAccount(toUserId) : minter
		const tx = await this.append({
			kind: 'mint',
			from_address: null,
			to_address: to.address,
			amount,
			callerUserId
		})
		await this.store.putToken({
			...token,
			minter_address: token.minter_address ?? minter.address,
			total_supply: token.total_supply + amount
		})
		return tx
	}

	/** Transfer aEUR from the caller to a destination address. Rejects an overdraft. */
	async transfer(callerUserId: string, toAddress: Address, amount: number): Promise<ChainTx> {
		assertAmount(amount)
		const from = await this.ensureAccount(callerUserId)
		if (toAddress === from.address) throw new Error('cannot transfer to self')
		const balance = await this.getBalanceByAddress(from.address)
		if (balance < amount) throw new Error(`insufficient balance: have ${balance}, need ${amount}`)
		return this.append({
			kind: 'transfer',
			from_address: from.address,
			to_address: toAddress,
			amount,
			callerUserId
		})
	}

	async listTxs(): Promise<ChainTx[]> {
		return this.store.listTxs()
	}

	/** Re-check a tx's signature against its caller address (the public, swappable check). */
	verifyTx(tx: ChainTx): boolean {
		const payload = canonicalPayload({
			seq: tx.seq,
			kind: tx.kind,
			token: tx.token,
			from_address: tx.from_address,
			to_address: tx.to_address,
			amount: tx.amount,
			nonce: tx.nonce,
			prev_hash: tx.prev_hash
		})
		return this.signer.verify(payload, tx.signature, tx.caller)
	}
}
