import type { Context } from 'hono'
import { sql } from 'kysely'
import { auth } from './auth'
import { db } from './db'

/**
 * Postmark INBOUND webhook receiver (POST /webhooks/inbox/mail). Postmark parses an inbound email
 * and POSTs the JSON here; we store the parsed headline fields + the full raw MIME + the entire
 * payload.
 *
 * Security: Postmark inbound webhooks have NO signature/HMAC, so we authenticate with a SHARED
 * SECRET (`POSTMARK_INBOUND_SECRET`). It accepts the secret three ways so you can pick what the
 * Postmark UI supports: HTTP Basic auth (set the webhook URL as
 * `https://<user>:<secret>@api.next.aven.ceo/webhooks/inbox/mail`), a `?token=<secret>` query, or an
 * `X-Inbox-Token: <secret>` header. FAIL-CLOSED: if the secret env isn't set, every request is
 * rejected. Transport is HTTPS (api.next.aven.ceo), so the secret + mail are encrypted in flight.
 * No Postmark API key is needed to RECEIVE — Postmark pushes to us. board 0060.
 */

const inboundSecret = (): string | undefined => process.env.POSTMARK_INBOUND_SECRET
const inboundUser = (): string => process.env.POSTMARK_INBOUND_USER ?? 'postmark'

/** Length-guarded constant-time-ish string equality (avoid early-exit timing leaks). */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false
	let r = 0
	for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
	return r === 0
}

/** True iff the request carries the shared secret (Basic auth, ?token=, or X-Inbox-Token). */
function authed(c: Context): boolean {
	const secret = inboundSecret()
	if (!secret) return false // fail closed — not configured
	const auth = c.req.header('authorization') ?? ''
	if (auth.startsWith('Basic ')) {
		try {
			const [u, p] = atob(auth.slice(6)).split(':')
			if (p && safeEqual(p, secret) && safeEqual(u ?? '', inboundUser())) return true
		} catch {
			/* malformed header */
		}
	}
	const token = c.req.query('token') ?? c.req.header('x-inbox-token') ?? ''
	return token.length > 0 && safeEqual(token, secret)
}

type PostmarkInbound = {
	MessageID?: string
	From?: string
	FromName?: string
	FromFull?: { Email?: string; Name?: string }
	To?: string
	Subject?: string
	TextBody?: string
	HtmlBody?: string
	MailboxHash?: string
	RawEmail?: string
}

export async function mailInbox(c: Context): Promise<Response> {
	if (!authed(c)) return c.json({ error: 'unauthorized' }, 401)
	const mail = (await c.req.json().catch(() => null)) as PostmarkInbound | null
	if (!mail || typeof mail !== 'object') return c.json({ error: 'bad_payload' }, 400)
	try {
		await db()
			.insertInto('inbound_email')
			.values({
				id: crypto.randomUUID(),
				message_id: mail.MessageID ?? null,
				from_email: mail.FromFull?.Email ?? mail.From ?? null,
				from_name: mail.FromFull?.Name ?? mail.FromName ?? null,
				to_email: mail.To ?? null,
				subject: mail.Subject ?? null,
				text_body: mail.TextBody ?? null,
				html_body: mail.HtmlBody ?? null,
				mailbox_hash: mail.MailboxHash ?? null,
				raw_email: mail.RawEmail ?? null,
				payload: sql`${JSON.stringify(mail)}::jsonb`
			})
			// Postmark may retry — ignore a duplicate MessageID rather than erroring.
			.onConflict((oc) => oc.column('message_id').doNothing())
			.execute()
	} catch (e) {
		console.error('[inbox] store inbound email failed:', e)
		return c.json({ error: 'store_failed' }, 500)
	}
	// Postmark treats any 2xx as success (won't retry); a non-2xx makes it retry + eventually disable.
	return c.json({ ok: true })
}

/** Session + admin gate for the inbox VIEWER endpoints. Returns an error Response, or null if OK. */
async function adminGate(c: Context): Promise<Response | null> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	if (!session) return c.json({ error: 'unauthorized' }, 401)
	if ((session.user as { role?: string }).role !== 'admin')
		return c.json({ error: 'admin_only' }, 403)
	return null
}

/** Admin-only: list inbound emails (newest first), headline fields only (no bodies/raw). board 0060. */
export async function inboxList(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 200)
	const messages = await db()
		.selectFrom('inbound_email')
		.select(['id', 'message_id', 'from_email', 'from_name', 'to_email', 'subject', 'received_at'])
		.orderBy('received_at', 'desc')
		.limit(limit)
		.execute()
	return c.json({ messages })
}

/** Admin-only: one inbound email's full detail (bodies + raw MIME + payload). board 0060. */
export async function inboxGet(c: Context): Promise<Response> {
	const gate = await adminGate(c)
	if (gate) return gate
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id_required' }, 400)
	const message = await db()
		.selectFrom('inbound_email')
		.selectAll()
		.where('id', '=', id)
		.executeTakeFirst()
	if (!message) return c.json({ error: 'not_found' }, 404)
	return c.json({ message })
}
