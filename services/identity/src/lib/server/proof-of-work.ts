import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type pg from 'pg'
import { withTransaction } from './db.js'

export type ProofPurpose = 'sign-in'
export const protectedAuthPaths = new Set(['/api/auth/passkey/verify-authentication'])
export class ProofOfWorkError extends Error {
	constructor(
		public code: string,
		message: string
	) {
		super(message)
	}
}
const digest = (id: string, nonce: string, purpose: string, counter: number) =>
	createHash('sha256').update(`${id}:${nonce}:${purpose}:${counter}`).digest()
export function hasLeadingZeroBits(value: Uint8Array, bits: number): boolean {
	const bytes = Math.floor(bits / 8)
	for (let index = 0; index < bytes; index += 1) if (value[index] !== 0) return false
	const remaining = bits % 8
	return remaining === 0 || ((value[bytes] ?? 255) & (0xff << (8 - remaining))) === 0
}
export class ProofOfWorkService {
	constructor(
		private pool: pg.Pool,
		private difficulty: number,
		private ttlSeconds: number
	) {}
	async issue(now = Date.now()) {
		const challenge = {
			id: randomUUID(),
			nonce: randomBytes(32).toString('base64url'),
			purpose: 'sign-in' as const,
			difficultyBits: this.difficulty,
			expiresAt: now + this.ttlSeconds * 1000
		}
		await this.pool.query(
			'INSERT INTO proof_of_work_challenges(id,nonce,purpose,difficulty_bits,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6)',
			[
				challenge.id,
				challenge.nonce,
				challenge.purpose,
				challenge.difficultyBits,
				challenge.expiresAt,
				now
			]
		)
		return challenge
	}
	async verifyAndConsume(proof: string | null, now = Date.now()): Promise<void> {
		if (!proof)
			throw new ProofOfWorkError('PROOF_OF_WORK_REQUIRED', 'Complete the proof-of-work challenge.')
		const separator = proof.lastIndexOf('.')
		const id = proof.slice(0, separator)
		const counter = Number(proof.slice(separator + 1))
		if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isSafeInteger(counter) || counter < 0)
			throw new ProofOfWorkError('PROOF_OF_WORK_INVALID', 'The proof is malformed.')
		await withTransaction(this.pool, async (client) => {
			const row = (
				await client.query<{
					nonce: string
					difficulty_bits: number
					expires_at: number
					used_at: number | null
				}>(
					'SELECT nonce,difficulty_bits,expires_at,used_at FROM proof_of_work_challenges WHERE id=$1 FOR UPDATE',
					[id]
				)
			).rows[0]
			if (
				!row ||
				row.used_at !== null ||
				row.expires_at < now ||
				!hasLeadingZeroBits(digest(id, row.nonce, 'sign-in', counter), row.difficulty_bits)
			)
				throw new ProofOfWorkError('PROOF_OF_WORK_INVALID', 'The proof is invalid or expired.')
			await client.query('UPDATE proof_of_work_challenges SET used_at=$1 WHERE id=$2', [now, id])
		})
	}
}
