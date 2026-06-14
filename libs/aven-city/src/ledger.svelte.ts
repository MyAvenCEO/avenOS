/**
 * HEARTS ledger — a fake, blockchain-inspired token ledger for MaiaCity.
 *
 * Each player has their own personal currency (AliceHearts, BobHearts, …).
 * Hearts are minted, never transacted (investing comes later), so every block
 * in the chain is a coinbase MINT to the player:
 *   - one GENESIS_MINT of 50 000 at tick 0
 *   - one TICK_MINT of +1 for every game tick the player advances
 *
 * The chain is append-only and hash-linked (prevHash → hash) to mimic a real
 * ledger. State is in-memory only for now (resets on reload).
 */

export const GENESIS_MINT_AMOUNT = 50_000
export const TICK_MINT_REWARD = 1

export type HeartsTxType = 'GENESIS_MINT' | 'TICK_MINT'

export type HeartsTx = {
	/** Block height — index in the chain. */
	index: number
	type: HeartsTxType
	/** Sender. null = coinbase (freshly minted, no source). */
	from: string | null
	/** Recipient — the player's currency holder. */
	to: string
	amount: number
	/** Game round at which this block was minted. */
	tick: number
	timestamp: number
	prevHash: string
	hash: string
}

const ZERO_HASH = '00000000'

/** Tiny deterministic FNV-1a hash → 8 hex chars. Not cryptographic — looks the part. */
function hashBlock(payload: string): string {
	let h = 0x811c9dc5
	for (let i = 0; i < payload.length; i++) {
		h ^= payload.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return (h >>> 0).toString(16).padStart(8, '0')
}

function buildTx(
	index: number,
	type: HeartsTxType,
	to: string,
	amount: number,
	tick: number,
	prev: HeartsTx | undefined
): HeartsTx {
	const prevHash = prev ? prev.hash : ZERO_HASH
	const timestamp = Date.now()
	const hash = hashBlock(`${index}|${type}|${to}|${amount}|${tick}|${timestamp}|${prevHash}`)
	return { index, type, from: null, to, amount, tick, timestamp, prevHash, hash }
}

export class HeartsLedger {
	/** Player whose currency this is — e.g. 'Alice' → AliceHearts. */
	readonly player: string

	chain = $state<HeartsTx[]>([])
	/** Current game round. */
	tick = $state(0)
	/** Running balance (derived from the chain, tracked for cheap reads). */
	balance = $state(0)

	constructor(player = 'Alice') {
		this.player = player
		// Genesis: one-time 50 000 mint at tick 0.
		const genesis = buildTx(0, 'GENESIS_MINT', player, GENESIS_MINT_AMOUNT, 0, undefined)
		this.chain = [genesis]
		this.balance = GENESIS_MINT_AMOUNT
	}

	/** Currency symbol/name, e.g. 'AliceHearts'. */
	get symbol(): string {
		return `${this.player}Hearts`
	}

	/** Most recent block. */
	get head(): HeartsTx {
		return this.chain[this.chain.length - 1]
	}

	/**
	 * Advance `count` ticks. Each tick is a single TICK_MINT of +1 Heart, so the
	 * chain grows by `count` blocks. Built in one batch to avoid O(n²) churn.
	 */
	advanceTicks(count: number): void {
		if (count <= 0) return
		const next = this.chain.slice()
		let t = this.tick
		let bal = this.balance
		for (let i = 0; i < count; i++) {
			t += 1
			const tx = buildTx(next.length, 'TICK_MINT', this.player, TICK_MINT_REWARD, t, next[next.length - 1])
			next.push(tx)
			bal += TICK_MINT_REWARD
		}
		this.chain = next
		this.tick = t
		this.balance = bal
	}
}

export function formatHearts(amount: number): string {
	return amount.toLocaleString('en-US')
}
