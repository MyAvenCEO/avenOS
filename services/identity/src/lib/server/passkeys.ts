import type pg from 'pg'
import { withTransaction } from './db.js'
import { isToken, randomToken, sha256Hex } from './tokens.js'

export interface PasskeySummary {
	id: string
	name: string | null
	device_type: string
	backed_up: boolean
	prf_enabled: boolean
	created_at: Date
}

export class PasskeyService {
	constructor(
		private readonly pool: pg.Pool,
		private readonly requirePrf: boolean
	) {}

	async list(userId: string): Promise<PasskeySummary[]> {
		return (
			await this.pool.query<PasskeySummary>(
				'SELECT id,name,device_type,backed_up,prf_enabled,created_at FROM passkey WHERE user_id=$1 ORDER BY created_at ASC',
				[userId]
			)
		).rows
	}

	async issueSetupLink(userId: string): Promise<string | null> {
		const predicate = this.requirePrf ? 'AND prf_enabled=true' : ''
		const enrolled = await this.pool.query(
			`SELECT 1 FROM passkey WHERE user_id=$1 ${predicate} LIMIT 1`,
			[userId]
		)
		if (enrolled.rows[0]) return null
		const token = randomToken()
		await this.pool.query(
			`INSERT INTO setup_links(user_id,token_hash,created_at) VALUES($1,$2,now())
			 ON CONFLICT(user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,created_at=now(),last_used_at=NULL`,
			[userId, sha256Hex(token)]
		)
		return token
	}

	async verifySetupLink(token: string): Promise<{ userId: string } | null> {
		if (!isToken(token)) return null
		return withTransaction(this.pool, async (client) => {
			const row = (
				await client.query<{ user_id: string }>(
					'SELECT user_id FROM setup_links WHERE token_hash=$1 FOR UPDATE',
					[sha256Hex(token)]
				)
			).rows[0]
			if (!row) return null
			const active = await client.query('SELECT 1 FROM "user" WHERE id=$1', [row.user_id])
			if (!active.rows[0]) return null
			await client.query('UPDATE setup_links SET last_used_at=now() WHERE user_id=$1', [
				row.user_id
			])
			return { userId: row.user_id }
		})
	}

	async finalize(
		userId: string,
		credentialId: string | undefined,
		prfEnabled: boolean
	): Promise<void> {
		await withTransaction(this.pool, async (client) => {
			const registered = credentialId
				? await client.query<{ id: string }>(
						'SELECT id FROM passkey WHERE user_id=$1 AND credential_id=$2',
						[userId, credentialId]
					)
				: await client.query<{ id: string }>(
						'SELECT id FROM passkey WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
						[userId]
					)
			const passkey = registered.rows[0]
			if (!passkey) throw new Error('Registered passkey not found.')
			if (this.requirePrf && !prfEnabled) throw new Error('Passkey PRF support is required.')
			await client.query('UPDATE passkey SET prf_enabled=$1 WHERE id=$2', [prfEnabled, passkey.id])
			// Setup links are bootstrap credentials. A normal authenticated session can
			// add as many additional passkeys as the account holder needs.
			await client.query('DELETE FROM setup_links WHERE user_id=$1', [userId])
		})
	}
}
