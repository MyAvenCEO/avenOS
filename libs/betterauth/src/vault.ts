import type { Context } from 'hono'
import { auth } from './auth'
import { tierOf } from './credits'
import { db } from './db'
import { meetsTier } from './tier'

// E2EE secrets vault (board 0055). Server-blind: every column the client sends is already
// ciphertext / wrapped-key / salt / nonce — this module never sees a plaintext secret, the
// master DEK, the KEK, or the PRF. Gated to avenFOUNDER and above (the passkey-2FA tiers, 0052).
const MIN_TIER = 'avenFOUNDER'

/** Session + tier gate (board 0055): admins bypass the tier gate (founder/owner gets the vault
 * regardless of plan); everyone else needs avenFOUNDER+. Returns the uid (+ tier) or a 401/403. */
async function gate(c: Context): Promise<{ uid: string; tier: string } | Response> {
	const session = await auth.api.getSession({ headers: c.req.raw.headers })
	const uid = session?.user?.id
	if (!uid) return c.json({ error: 'unauthorized' }, 401)
	const role = (session.user as { role?: string }).role
	const tier = await tierOf(uid)
	if (role !== 'admin' && !meetsTier(tier, MIN_TIER)) {
		return c.json({ error: 'requires_avenfounder_or_higher', tier }, 403)
	}
	return { uid, tier }
}

type VaultBody = {
	credentialId?: string
	prfSalt?: string
	wrappedMasterKey?: string
	wrapNonce?: string
	alg?: string
}

export async function getVault(c: Context): Promise<Response> {
	const g = await gate(c)
	if (g instanceof Response) return g
	const row = await db()
		.selectFrom('vault')
		.select(['id', 'credential_id', 'prf_salt', 'wrapped_master_key', 'wrap_nonce', 'alg'])
		.where('user_id', '=', g.uid)
		.executeTakeFirst()
	return c.json({ vault: row ?? null })
}

export async function putVault(c: Context): Promise<Response> {
	const g = await gate(c)
	if (g instanceof Response) return g
	const b = (await c.req.json().catch(() => null)) as VaultBody | null
	if (!b?.credentialId || !b.prfSalt || !b.wrappedMasterKey || !b.wrapNonce) {
		return c.json({ error: 'credentialId, prfSalt, wrappedMasterKey, wrapNonce required' }, 400)
	}
	const now = new Date()
	const fields = {
		credential_id: b.credentialId,
		prf_salt: b.prfSalt,
		wrapped_master_key: b.wrappedMasterKey,
		wrap_nonce: b.wrapNonce,
		alg: b.alg ?? 'AES-256-GCM',
		updated_at: now
	}
	const existing = await db()
		.selectFrom('vault')
		.select('id')
		.where('user_id', '=', g.uid)
		.executeTakeFirst()
	let id: string
	if (existing) {
		id = existing.id
		await db().updateTable('vault').set(fields).where('id', '=', id).execute()
	} else {
		id = crypto.randomUUID()
		await db()
			.insertInto('vault')
			.values({ id, user_id: g.uid, created_at: now, ...fields })
			.execute()
	}
	return c.json({ id })
}

type SecretBody = {
	kind?: string
	label?: string | null
	ciphertext?: string
	nonce?: string
	alg?: string
}

async function vaultIdFor(uid: string): Promise<string | null> {
	const v = await db()
		.selectFrom('vault')
		.select('id')
		.where('user_id', '=', uid)
		.executeTakeFirst()
	return v?.id ?? null
}

export async function listSecrets(c: Context): Promise<Response> {
	const g = await gate(c)
	if (g instanceof Response) return g
	const rows = await db()
		.selectFrom('secret')
		.select(['id', 'kind', 'label', 'ciphertext', 'nonce', 'alg'])
		.where('user_id', '=', g.uid)
		.orderBy('created_at')
		.execute()
	return c.json({ secrets: rows })
}

export async function putSecret(c: Context): Promise<Response> {
	const g = await gate(c)
	if (g instanceof Response) return g
	const b = (await c.req.json().catch(() => null)) as SecretBody | null
	if (!b?.kind || !b.ciphertext || !b.nonce) {
		return c.json({ error: 'kind, ciphertext, nonce required' }, 400)
	}
	const vid = await vaultIdFor(g.uid)
	if (!vid) return c.json({ error: 'no_vault' }, 409)
	const now = new Date()
	const fields = {
		label: b.label ?? null,
		ciphertext: b.ciphertext,
		nonce: b.nonce,
		alg: b.alg ?? 'AES-256-GCM',
		updated_at: now
	}
	const existing = await db()
		.selectFrom('secret')
		.select('id')
		.where('vault_id', '=', vid)
		.where('kind', '=', b.kind)
		.executeTakeFirst()
	let id: string
	if (existing) {
		id = existing.id
		await db().updateTable('secret').set(fields).where('id', '=', id).execute()
	} else {
		id = crypto.randomUUID()
		await db()
			.insertInto('secret')
			.values({ id, vault_id: vid, user_id: g.uid, kind: b.kind, created_at: now, ...fields })
			.execute()
	}
	return c.json({ id, kind: b.kind })
}

export async function deleteSecret(c: Context): Promise<Response> {
	const g = await gate(c)
	if (g instanceof Response) return g
	const id = c.req.param('id')
	if (!id) return c.json({ error: 'id required' }, 400)
	await db().deleteFrom('secret').where('id', '=', id).where('user_id', '=', g.uid).execute()
	return c.json({ ok: true })
}
