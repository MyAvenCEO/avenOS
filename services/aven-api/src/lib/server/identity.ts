// Identity module: the ONLY place other modules touch the "user" table.
// Everything else (Better Auth's own tables, sessions) is managed by Better
// Auth itself. When the app is split, these functions become the identity
// service's API.
import { randomUUID } from 'node:crypto'
import { writeAudit } from './audit.js'
import type { Queryable } from './db.js'

export interface IdentityUser {
	id: string
	name: string
	email: string
}

export async function findUserByEmail(
	connection: Queryable,
	email: string
): Promise<IdentityUser | null> {
	const row = (
		await connection.query('SELECT id, name, email FROM "user" WHERE lower(email)=lower($1)', [
			email
		])
	).rows[0] as IdentityUser | undefined
	return row ?? null
}

export async function isActiveUser(connection: Queryable, userId: string): Promise<boolean> {
	return Boolean((await connection.query('SELECT 1 FROM "user" WHERE id=$1', [userId])).rows[0])
}

// Account creation happens exclusively through a completed purchase. The
// buyer proved control of the inbox via the emailed checkout, so the account
// starts verified.
export async function ensureVerifiedUser(
	connection: Queryable,
	email: string,
	source: string
): Promise<IdentityUser> {
	const existing = await findUserByEmail(connection, email)
	if (existing) return existing
	const id = randomUUID()
	const name = email.split('@')[0] ?? email
	// Concurrent creations (e.g. two payment webhooks for the same buyer) race
	// on the unique email; the loser falls through to the winner's row.
	const inserted = await connection.query(
		'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$2,$3,true,now(),now()) ON CONFLICT (email) DO NOTHING',
		[id, name, email]
	)
	if (inserted.rowCount !== 1) {
		const concurrent = await findUserByEmail(connection, email)
		if (!concurrent) throw new Error('Concurrent account creation failed.')
		return concurrent
	}
	await writeAudit(connection, {
		eventType: 'user.created',
		targetUserId: id,
		metadata: { source }
	})
	return { id, name, email }
}
