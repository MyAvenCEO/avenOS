import type pg from 'pg'
import { writeAudit } from './audit.js'
import { isBearerToken, randomToken, sha256Hex } from './crypto.js'
import { type Queryable, withTransaction } from './db.js'
import { isActiveUser } from './identity.js'

export class PasskeyService {
	constructor(
		private pool: pg.Pool,
		private requirePrf: boolean
	) {}

	private async enrollmentComplete(connection: Queryable, userId: string): Promise<boolean> {
		const predicate = this.requirePrf ? 'AND prf_enabled=true' : ''
		return Boolean(
			(
				await connection.query(`SELECT 1 FROM passkey WHERE user_id=$1 ${predicate} LIMIT 1`, [
					userId
				])
			).rows[0]
		)
	}

	async status(userId: string) {
		const passkeys = (
			await this.pool.query(
				'SELECT id,name,device_type,backed_up,prf_enabled,created_at FROM passkey WHERE user_id=$1 ORDER BY created_at ASC',
				[userId]
			)
		).rows
		return { passkeys }
	}

	async issueSetupLink(connection: Queryable, userId: string): Promise<string | null> {
		if (await this.enrollmentComplete(connection, userId)) return null
		const token = randomToken(32)
		await connection.query(
			'INSERT INTO setup_links (user_id,token_hash,created_at) VALUES ($1,$2,now()) ON CONFLICT (user_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,created_at=EXCLUDED.created_at,last_used_at=NULL',
			[userId, sha256Hex(token)]
		)
		await writeAudit(connection, { eventType: 'passkey.setup_link_issued', targetUserId: userId })
		return token
	}

	// Reusable until a passkey exists. Every click may establish a fresh,
	// short-lived setup session; successful registration deletes this row.
	async verifySetupLogin(token: string): Promise<{ userId: string } | null> {
		if (!isBearerToken(token)) return null
		return withTransaction(this.pool, async (client) => {
			const row = (
				await client.query('SELECT user_id FROM setup_links WHERE token_hash=$1 FOR UPDATE', [
					sha256Hex(token.trim())
				])
			).rows[0] as { user_id: string } | undefined
			if (!row || !(await isActiveUser(client, row.user_id))) return null
			if (await this.enrollmentComplete(client, row.user_id)) {
				await client.query('DELETE FROM setup_links WHERE user_id=$1', [row.user_id])
				return null
			}
			await client.query('UPDATE setup_links SET last_used_at=now() WHERE user_id=$1', [
				row.user_id
			])
			await writeAudit(client, { eventType: 'passkey.setup_link_used', targetUserId: row.user_id })
			return { userId: row.user_id }
		})
	}

	async finishEnrollment(
		userId: string,
		prfEnabled: boolean,
		credentialId?: string
	): Promise<void> {
		await withTransaction(this.pool, async (client) => {
			const passkey = credentialId
				? (
						await client.query('SELECT id FROM passkey WHERE user_id=$1 AND credential_id=$2', [
							userId,
							credentialId
						])
					).rows[0]
				: (
						await client.query(
							'SELECT id FROM passkey WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
							[userId]
						)
					).rows[0]
			if (!passkey) throw new Error('Registered passkey not found.')
			await client.query('UPDATE passkey SET prf_enabled=$1 WHERE id=$2', [
				prfEnabled,
				(passkey as { id: string }).id
			])
			await client.query('DELETE FROM setup_links WHERE user_id=$1', [userId])
			await writeAudit(client, { eventType: 'passkey.enrolled', targetUserId: userId })
		})
	}
}
