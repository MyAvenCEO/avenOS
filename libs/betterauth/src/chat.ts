import { randomUUID } from 'node:crypto'
import { db } from './db'

// Persisted AI chat sessions + messages. Everything is scoped to the authenticated
// user: a session is owned by user_id, and messages are only reachable via a session
// the caller owns. board 0051.

/** Resolve the session for this turn: reuse the caller's session if it exists, else create one. */
export async function ensureSession(
	userId: string,
	sessionId: string | undefined,
	firstUserText: string
): Promise<string> {
	if (sessionId) {
		const existing = await db()
			.selectFrom('ai_chat_session')
			.select('id')
			.where('id', '=', sessionId)
			.where('user_id', '=', userId)
			.executeTakeFirst()
		if (existing) return existing.id
	}
	const id = randomUUID()
	const title = firstUserText.trim().slice(0, 80) || 'New chat'
	await db()
		.insertInto('ai_chat_session')
		.values({ id, user_id: userId, title, created_at: new Date(), updated_at: new Date() })
		.execute()
	return id
}

/** Append a message to a session and bump the session's updated_at. */
export async function persistMessage(
	sessionId: string,
	role: 'user' | 'assistant',
	content: string
): Promise<void> {
	await db()
		.insertInto('ai_message')
		.values({ id: randomUUID(), session_id: sessionId, role, content, created_at: new Date() })
		.execute()
	await db()
		.updateTable('ai_chat_session')
		.set({ updated_at: new Date() })
		.where('id', '=', sessionId)
		.execute()
}

/** A user's sessions, most-recently-updated first. */
export async function listSessions(userId: string) {
	return db()
		.selectFrom('ai_chat_session')
		.select(['id', 'title', 'updated_at'])
		.where('user_id', '=', userId)
		.orderBy('updated_at', 'desc')
		.limit(50)
		.execute()
}

/** Messages for a session the user owns; null if the session isn't theirs (or missing). */
export async function getSessionMessages(userId: string, sessionId: string) {
	const owns = await db()
		.selectFrom('ai_chat_session')
		.select('id')
		.where('id', '=', sessionId)
		.where('user_id', '=', userId)
		.executeTakeFirst()
	if (!owns) return null
	return db()
		.selectFrom('ai_message')
		.select(['id', 'role', 'content', 'created_at'])
		.where('session_id', '=', sessionId)
		.orderBy('created_at', 'asc')
		.execute()
}
